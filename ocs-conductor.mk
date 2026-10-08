######################################
#
# ocs-conductor
#
######################################
OCS_CONDUCTOR_VERSION = 0.01
OCS_CONDUCTOR_SITE = https://github.com/OilCanSteve/ocs-conductor.git
OCS_CONDUCTOR_SITE_METHOD = git
OCS_CONDUCTOR_BUNDLES = ocs-conductor.lv2

OCS_CONDUCTOR_TARGET_MAKE = $(TARGET_MAKE_ENV) $(TARGET_CONFIGURE_OPTS) $(MAKE) MOD=1 OPTIMIZATIONS="" PREFIX=/usr -C $(@D)/source

define OCS_CONDUCTOR_BUILD_CMDS
	$(OCS_CONDUCTOR_TARGET_MAKE)
endef

define OCS_CONDUCTOR_INSTALL_TARGET_CMDS
	$(OCS_CONDUCTOR_TARGET_MAKE) install DESTDIR=$(TARGET_DIR)
endef

$(eval $(generic-package))
