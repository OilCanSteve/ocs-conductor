// Copyright 2014-2016 David Robillard <d@drobilla.net>
// SPDX-License-Identifier: ISC

#include "uris.h"

#include "lv2/atom/atom.h"
#include "lv2/atom/util.h"
#include "lv2/core/lv2.h"
#include "lv2/core/lv2_util.h"
#include "lv2/log/log.h"
#include "lv2/log/logger.h"
#include "lv2/midi/midi.h"
#include "lv2/urid/urid.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <sys/time.h>

#ifndef ORCH_DEBUG
#define ORCH_DEBUG 0
#endif

#if ORCH_DEBUG
#define ORCH_DEBUGF(...) fprintf(stderr, __VA_ARGS__)
#else
#define ORCH_DEBUGF(...) ((void)0)
#endif




#define N_STATES 16
#define MAX_DISPATCH_RETRIES 4





enum {
  midi_out = 0,
  MIDI_CHANNEL = 1,
  ENACT_CHANGES_ONLY = 2,
  STATE_TRIGGER = 3,
  CC_A_FREE_NUM = 4,
  CC_B_FREE_NUM = 5,
  CC_NUM_FOR_BIT_START = 6,
  CC_NUM_FOR_BIT_END = 12,
  OVERFLOW_BASE = 13,
  SYSEX_OUT = 14,
  SYSEX_PACKET_ID = 15,
  STATE_DATA_START = 16,
  STATE_DATA_END = 63
} ;


typedef struct {
  // Features
  LV2_URID_Map*  map;
  LV2_Log_Logger logger;

  // Ports
  
  LV2_Atom_Sequence*   midi_out;
  const float* midi_channel;
  const float* highest_state;
  const float* changes_only;
  const float* state_trigger;
  const float* cc_a_free_num;
  const float* cc_b_free_num;
  const float* seven_bit_state[N_STATES];
  const float* cc_num_for_bit[7];
  const float* cc_a_free_val[N_STATES];
  const float* cc_b_free_val[N_STATES];
  const float* overflow_base;
  LV2_Atom_Sequence*   sysex_out;
  const float* sysex_packet_id;

  int curr_trigger_val;

  bool last_bit_array[7];

  // True once the first run() cycle has synced curr_trigger_val to the
  // host-supplied state_trigger value, without treating it as a trigger.
  // This avoids spurious CC/SysEx dispatch when a saved pedalboard restores
  // state_trigger to a non-zero value on instantiation.
  bool initialized;

  // If a dispatch could not be fully delivered (e.g. the host's atom output
  // buffer was momentarily too small), we remember the state here and
  // retry it on the next run() cycle instead of silently dropping it.
  bool dispatch_pending;
  int  pending_ctv;
  uint8_t dispatch_retry_count;

  // URIs
  conductorURIs uris; 

} conductor;



static void
connect_port(LV2_Handle instance, uint32_t port, void* data)
{
  conductor* self = (conductor*)instance;
  
  
  switch (port) {
  case midi_out:
   
   self->midi_out = (LV2_Atom_Sequence*)data;
   
   break;

  case MIDI_CHANNEL:
    self->midi_channel = (const float*)data;
    break;

  case ENACT_CHANGES_ONLY:
    self->changes_only = ( const float*) data;
    break;  

  case STATE_TRIGGER:
    self->state_trigger = (const  float*) data;
    break;

  case CC_A_FREE_NUM:
    self->cc_a_free_num = ( const float*) data;
    break;

  case CC_B_FREE_NUM:
    self->cc_b_free_num = ( const float*) data;
    break;  
  

  // Handle ports in three groups
  

  default:

  if (port >= CC_NUM_FOR_BIT_START && port <= CC_NUM_FOR_BIT_END) {
    self->cc_num_for_bit[port - CC_NUM_FOR_BIT_START] = (const float*)data;
  } else if (port == OVERFLOW_BASE) {
    self->overflow_base = (const float*)data;
  } else if (port == SYSEX_OUT) {
    self->sysex_out = (LV2_Atom_Sequence*)data;
  } else if (port == SYSEX_PACKET_ID) {
    self->sysex_packet_id = (const float*)data;
  } else if (port >= STATE_DATA_START && port <= STATE_DATA_END) {
    const uint32_t state_index = (port - STATE_DATA_START) / 3;
    const uint32_t state_field = (port - STATE_DATA_START) % 3;

    if (state_field == 0) {
      self->seven_bit_state[state_index] = (const float*)data;
    } else if (state_field == 1) {
      self->cc_a_free_val[state_index] = (const float*)data;
    } else {
      self->cc_b_free_val[state_index] = (const float*)data;
    }
  } else return;
  break;
  }//end of switch
}//end of connect_port function

static LV2_Handle
instantiate(const LV2_Descriptor*     descriptor,
            double                    rate,
            const char*               path,
            const LV2_Feature* const* features)
{
  // Allocate and initialise instance structure.
  conductor* self = (conductor*)calloc(1, sizeof(conductor));
  

  self->curr_trigger_val = 0;

  // Scan host features for URID map
  // clang-format off
  const char*  missing = lv2_features_query(
    features,
    LV2_LOG__log,  &self->logger.log, false,
    LV2_URID__map, &self->map,        true,
    NULL);
  // clang-format on

  lv2_log_logger_set_map(&self->logger, self->map);
  if (missing) {
    lv2_log_error(&self->logger, "Missing feature <%s>\n", missing);
    free(self);
    return NULL;
  }

  map_conductor_uris(self->map, &self->uris);
  self->curr_trigger_val = 0;
 

  return (LV2_Handle)self;
}



static void
cleanup(LV2_Handle instance)
{
  free(instance);
}

static bool sendMidiCCMessages(conductor* self, int triggerVal, uint32_t out_capacity);
static bool sysExOut(conductor* self, int cTrigVal, uint32_t out_capacity);
static bool fireMidiEvent(conductor* self, uint8_t ccNum, uint8_t ccVal, uint32_t out_capacity) ;

static uint8_t
clamp_u7f(float value)
{
  int ivalue = (int)value;
  if (ivalue < 0) {
    return 0;
  }

  if (ivalue > 127) {
    return 127;
  }

  return (uint8_t)ivalue;
}


static void
run(LV2_Handle instance, uint32_t sample_count)
{
  conductor*     self = (conductor*)instance;

  (void)sample_count;

  const uint32_t midi_capacity  = self->midi_out->atom.size;
  const uint32_t sysex_capacity = self->sysex_out->atom.size;

  lv2_atom_sequence_clear(self->midi_out);
  self->midi_out->atom.type = self->uris.atom_Sequence;
  lv2_atom_sequence_clear(self->sysex_out);
  self->sysex_out->atom.type = self->uris.atom_Sequence;

  // On the very first run() cycle, just adopt whatever value the host has
  // already placed on state_trigger (e.g. a restored pedalboard control
  // value) without treating it as a fresh trigger to dispatch. This avoids
  // an unwanted CC/SysEx burst whenever a saved pedalboard is opened with
  // state_trigger already non-zero.
  if (!self->initialized) {
    self->initialized      = true;
    self->curr_trigger_val = (uint8_t) *self->state_trigger;
    return;
  }

  int  ctv             = 0;
  bool have_new_trigger = false;

  if (self->dispatch_pending) {
    // A previous cycle failed to fully deliver its events (e.g. the host's
    // atom output buffer was momentarily too small). Retry the exact same
    // state before considering any newer trigger value, so a real trigger
    // is never silently dropped.
    ctv              = self->pending_ctv;
    have_new_trigger = true;
  } else if (self->curr_trigger_val != (uint8_t) *self->state_trigger) {// Trigger value has changed
      self->curr_trigger_val = (uint8_t) *self->state_trigger;//resetting trigger value for future comparisons
      ctv = self->curr_trigger_val-1;//geting the zero indexed version

      if (ctv<0)
      {
        //sysExOut(self, ctv);  //sending a minus value just causes all sysex values to be zeroed
        return; //nothing happens in the zero state so we just exit
      }
      int base_state = (int)*self->overflow_base;
      if (base_state < 1) {
        base_state = 1;
      } else if (base_state > (N_STATES - 1)) {
        base_state = (N_STATES - 1);
      }

      if (ctv > (N_STATES - 1)) {
        const int base_index = base_state - 1;
        const int cycle_len  = N_STATES - base_index;
        ctv = base_index + ((ctv - N_STATES) % cycle_len);
      }

      ORCH_DEBUGF(
        "[conductor] trig=%u overflow_base=%d mapped_state=%d\n",
        self->curr_trigger_val,
        base_state,
        ctv + 1);

      have_new_trigger = true;
  }

  if (have_new_trigger) {
    const bool cc_ok    = sendMidiCCMessages(self, ctv, midi_capacity);
    const bool sysex_ok = sysExOut(self, ctv, sysex_capacity);

    if (cc_ok && sysex_ok) {
      self->dispatch_pending = false;
      self->dispatch_retry_count = 0;
    } else {
      // Buffer couldn't hold everything this cycle. Retry a few times, but
      // do not stay stuck forever replaying a stale pending state.
      if (!self->dispatch_pending) {
        self->dispatch_retry_count = 1;
      } else {
        ++self->dispatch_retry_count;
      }

      if (self->dispatch_retry_count >= MAX_DISPATCH_RETRIES) {
        ORCH_DEBUGF(
          "[conductor] dispatch incomplete (cc_ok=%d sysex_ok=%d), dropping pending state=%d after %u retries\n",
          cc_ok,
          sysex_ok,
          ctv + 1,
          self->dispatch_retry_count);
        self->dispatch_pending = false;
        self->dispatch_retry_count = 0;
      } else {
        self->dispatch_pending = true;
        self->pending_ctv      = ctv;
        ORCH_DEBUGF(
          "[conductor] dispatch incomplete (cc_ok=%d sysex_ok=%d), will retry state=%d (%u/%d)\n",
          cc_ok,
          sysex_ok,
          ctv + 1,
          self->dispatch_retry_count,
          MAX_DISPATCH_RETRIES);
      }
    }
  }
}
  


  static bool sysExOut(conductor* self, int cTrigVal, uint32_t out_capacity)
  {
        lv2_atom_sequence_clear(self->sysex_out);
        self->sysex_out->atom.type = self->uris.atom_Sequence;

        // Always emit the 8-byte extended format:
        // F0 7D <sysex_packet_id> <trigger> <bits> <cc_a> <cc_b> F7
        struct _sysex {
          LV2_Atom_Event event;
          uint8_t bytes[8];
        } sysex;

        // Disabled state values (-1) must be clamped to 0, not cast directly
        // to uint8_t (which would produce 0xFF, an invalid SysEx data byte).
        const uint8_t payload[4] = {
          (uint8_t)clamp_u7f((float)cTrigVal),
          cTrigVal < 0 ? (uint8_t)0 : clamp_u7f(*self->seven_bit_state[cTrigVal]),
          cTrigVal < 0 ? (uint8_t)0 : clamp_u7f(*self->cc_a_free_val[cTrigVal]),
          cTrigVal < 0 ? (uint8_t)0 : clamp_u7f(*self->cc_b_free_val[cTrigVal]),
        };

        sysex.bytes[0] = 0xF0;
        sysex.bytes[1] = 0x7D; // Non-commercial ID
  sysex.bytes[2] = (uint8_t)*self->sysex_packet_id;
        memcpy(&sysex.bytes[3], payload, sizeof(payload));
        sysex.bytes[7] = 0xF7;
        sysex.event.body.size = sizeof(sysex.bytes);
        sysex.event.body.type = self->uris.midi_Event;
        sysex.event.time.frames = 0;
        return lv2_atom_sequence_append_event(
          self->sysex_out, out_capacity, &sysex.event) != NULL;
  }

  

static bool sendMidiCCMessages(conductor* self, int triggerVal, uint32_t out_capacity)
{
  bool all_ok = true;

  int seven_bit_int = (int)*self->seven_bit_state[triggerVal];
  if (seven_bit_int < 0) {
    seven_bit_int = 0;
  } else if (seven_bit_int > 127) {
    seven_bit_int = 127;
  }
  bool seven_bit_array[7];
  int i = 0;

  ORCH_DEBUGF(
    "[conductor] state=%d bits_change=%d changes_only=%d\n",
    triggerVal + 1,
    seven_bit_int,
    *self->changes_only ? 1 : 0);
  

  for (i = 0; i < 7; i++) {
    seven_bit_array[i] = (seven_bit_int & (1 << i)) != 0;
    bool currBit = seven_bit_array[i];
    if (*self->changes_only && currBit==self->last_bit_array[i]) continue;
    else
    {
      if (*self->cc_num_for_bit[i]==-1) continue; // Skip if no CC number is defined for this bit
      const uint8_t bit_cc_num = clamp_u7f(*self->cc_num_for_bit[i]);
      const uint8_t bit_cc_val = currBit ? 127 : 0;
      ORCH_DEBUGF(
        "[conductor] bit_%d -> cc=%u val=%u\n",
        i + 1,
        bit_cc_num,
        bit_cc_val);
      if (!fireMidiEvent(self, bit_cc_num, bit_cc_val, out_capacity)) {
        all_ok = false;
      }
    }
  }
  if (*self->cc_a_free_num>-1 && *self->cc_a_free_val[triggerVal]>-1) {
    const uint8_t cc_a_num = clamp_u7f(*self->cc_a_free_num);
    const uint8_t cc_a_val = clamp_u7f(*self->cc_a_free_val[triggerVal]);
    ORCH_DEBUGF(
      "[conductor] cc_a -> cc=%u val=%u\n",
      cc_a_num,
      cc_a_val);
    if (!fireMidiEvent(self, cc_a_num, cc_a_val, out_capacity)) {
      all_ok = false;
    }
  }
  if (*self->cc_b_free_num>-1 && *self->cc_b_free_val[triggerVal]>-1) {
    const uint8_t cc_b_num = clamp_u7f(*self->cc_b_free_num);
    const uint8_t cc_b_val = clamp_u7f(*self->cc_b_free_val[triggerVal]);
    ORCH_DEBUGF(
      "[conductor] cc_b -> cc=%u val=%u\n",
      cc_b_num,
      cc_b_val);
    if (!fireMidiEvent(self, cc_b_num, cc_b_val, out_capacity)) {
      all_ok = false;
    }
  }
  memcpy(self->last_bit_array, seven_bit_array, sizeof(seven_bit_array));

  return all_ok;
}


static bool fireMidiEvent(conductor* self, uint8_t ccNum, uint8_t ccVal, uint32_t out_capacity) {
  struct {
    LV2_Atom_Event event; // Base LV2 atom event
    uint8_t channel;      // MIDI channel (0-15)
    uint8_t controller;   // MIDI control change number (0-127)
    uint8_t value;        // MIDI control change value (0-127)
  } ccEvt = {0};
  int midi_channel = (int)*self->midi_channel;
  if (midi_channel < 0) {
    midi_channel = 0;
  } else if (midi_channel > 15) {
    midi_channel = 15;
  }
  
  ccEvt.event.body.type = self->uris.midi_Event;
  ccEvt.event.body.size = 3; // 3 bytes for MIDI CC message
  ccEvt.event.time.frames = 0;
  ccEvt.channel = 0xB0 | (uint8_t)midi_channel; // MIDI channels are 0-15
  ccEvt.controller = ccNum;
  ccEvt.value = ccVal; // Use 127 for ON, 0 for OFF
  return lv2_atom_sequence_append_event(self->midi_out, out_capacity, &ccEvt.event) != NULL;
}




static const void*
extension_data(const char* uri)
{
  return NULL;
}

static const LV2_Descriptor descriptor = {conductor_URI,
                                          instantiate,
                                          connect_port,
                                          NULL, // activate,
                                          run,
                                          NULL, // deactivate,
                                          cleanup,
                                          extension_data};

LV2_SYMBOL_EXPORT
const LV2_Descriptor*
lv2_descriptor(uint32_t index)
{
  return index == 0 ? &descriptor : NULL;
}
