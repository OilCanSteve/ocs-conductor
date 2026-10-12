#!/usr/bin/make -f
include Makefile.mk

# ---------replace _LC_LIB_NAME_with the actual dev folder name -----------------

STEM = ocs-conductor
PREFIX  ?= /usr/local
DESTDIR ?=
BUNDLEDIR = $(STEM).lv2

# --------------------------------------------------------------
# Default target is to build all plugins

all: build
build: output

# --------------------------------------------------------------
# _LC_LIB_NAME_ build rules

output: $(STEM).so

$(STEM).so: $(STEM).c
	$(CC) $^ $(BUILD_C_FLAGS) $(LINK_FLAGS) -lm $(SHARED) -o $@


# --------------------------------------------------------------

clean:
	rm -f $(STEM)$(LIB_EXT) 

# --------------------------------------------------------------

install: build
	install -d $(DESTDIR)$(PREFIX)/lib/lv2/$(BUNDLEDIR)
	install -d $(DESTDIR)$(PREFIX)/lib/lv2/$(BUNDLEDIR)/modgui

	install -m 644 *.so  $(DESTDIR)$(PREFIX)/lib/lv2/$(BUNDLEDIR)/
	install -m 644 *.ttl $(DESTDIR)$(PREFIX)/lib/lv2/$(BUNDLEDIR)/
	cp -a modgui/. $(DESTDIR)$(PREFIX)/lib/lv2/$(BUNDLEDIR)/modgui/

# --------------------------------------------------------------
