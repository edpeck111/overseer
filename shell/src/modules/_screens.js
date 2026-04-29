import { mountHome }       from "./home.js";
import { mountPower }      from "./power.js";
import { mountKnowledge }  from "./knowledge.js";
import { mountComms }      from "./comms.js";
import { mountMedical }    from "./medical.js";
import { mountNavigation } from "./navigation.js";
import { mountLog }        from "./log.js";
import { mountInventory }  from "./inventory.js";
import { mountTimeline }   from "./timeline.js";
import { mountAuspice }    from "./auspice.js";
import { mountSignal }     from "./signal.js";
import { mountRecreation } from "./recreation.js";
import { mountSystem }     from "./system.js";
import { mountHelp }       from "./help.js";

export const SCREENS = {
  HOME:        mountHome,
  POWER:       mountPower,
  KNOWLEDGE:   mountKnowledge,
  COMMS:       mountComms,
  MEDICAL:     mountMedical,
  NAVIGATION:  mountNavigation,
  LOG:         mountLog,
  INVENTORY:   mountInventory,
  TIMELINE:    mountTimeline,
  AUSPICE:     mountAuspice,
  SIGNAL:      mountSignal,
  RECREATION:  mountRecreation,
  SYSTEM:      mountSystem,
  "HELP & XTRAS": mountHelp,
};
