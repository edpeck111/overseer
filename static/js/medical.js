/* === MEDICAL TRIAGE MODULE: Decision trees for emergency response === */

// === TRIAGE DATA: Decision trees ===
// Each node: { q: "question", opts: [{label, next}] } for questions
//            { action: { title, steps[], doList[], dontList[], warning?, ref? } } for actions

const TRIAGE_TREES = {

  bleeding: {
    name: "BLEEDING",
    icon: "+",
    start: "severity",
    nodes: {
      severity: {
        q: "How severe is the bleeding?",
        opts: [
          { label: "Spurting or pulsing bright red blood", next: "arterial" },
          { label: "Steady flow of dark red blood", next: "venous" },
          { label: "Slow ooze or minor cut", next: "minor_bleed" },
          { label: "Bleeding won't stop after 10 minutes of pressure", next: "uncontrolled" }
        ]
      },
      arterial: {
        action: {
          title: "ARTERIAL BLEEDING — LIFE THREAT",
          cls: "danger",
          steps: [
            "Call for help immediately. This is a life-threatening emergency.",
            "Apply DIRECT PRESSURE with a clean cloth or bandage. Press HARD.",
            "If limb: Apply a tourniquet 2-3 inches above the wound. Note the time.",
            "If no tourniquet available: Pack the wound tightly with cloth and maintain constant pressure.",
            "Keep the person lying down. Elevate legs if possible (shock position).",
            "Do NOT remove blood-soaked dressings — add more on top.",
            "Monitor breathing and consciousness continuously."
          ],
          doList: ["Apply direct hard pressure", "Use a tourniquet on limbs", "Note time of tourniquet", "Keep patient warm", "Elevate legs for shock"],
          dontList: ["Remove blood-soaked bandages", "Use a tourniquet on neck/torso", "Give food or drink", "Leave the person alone"],
          ref: "tourniquet"
        }
      },
      venous: {
        action: {
          title: "VENOUS BLEEDING — SERIOUS",
          steps: [
            "Apply firm, direct pressure with a clean cloth.",
            "Maintain pressure for at least 15 minutes without peeking.",
            "If possible, elevate the wound above the heart.",
            "Once bleeding slows, apply a pressure bandage firmly (not so tight it cuts circulation).",
            "Check fingers/toes below bandage for warmth and color every 15 minutes.",
            "If bleeding soaks through, add more material on top — do not remove."
          ],
          doList: ["Firm direct pressure", "Elevate above heart", "Apply pressure bandage", "Monitor circulation below bandage"],
          dontList: ["Peek at wound frequently", "Remove soaked dressings", "Apply tourniquet unless pressure fails"]
        }
      },
      minor_bleed: {
        action: {
          title: "MINOR BLEEDING",
          steps: [
            "Clean the wound with clean water. Remove debris gently.",
            "Apply direct pressure with clean cloth for 5-10 minutes.",
            "Once bleeding stops, clean around the wound with mild soap and water.",
            "Apply antibiotic ointment if available.",
            "Cover with a sterile bandage or clean cloth.",
            "Change dressing daily. Watch for signs of infection (redness, swelling, warmth, pus)."
          ],
          doList: ["Clean with water", "Apply pressure", "Keep covered and clean", "Watch for infection signs"],
          dontList: ["Use hydrogen peroxide directly in wound", "Pick at scabs", "Leave dirty wounds uncovered"]
        }
      },
      uncontrolled: {
        q: "Where is the wound located?",
        opts: [
          { label: "Arm or leg", next: "tourniquet_apply" },
          { label: "Torso, neck, or groin (junctional area)", next: "junctional" },
          { label: "Head or face", next: "head_bleed" }
        ]
      },
      tourniquet_apply: {
        action: {
          title: "APPLY TOURNIQUET — LIMB BLEEDING",
          cls: "danger",
          steps: [
            "Apply tourniquet 2-3 inches above the wound (between wound and heart).",
            "Tighten until bleeding STOPS. It will be painful — this is expected.",
            "Write the TIME of application on the tourniquet or patient's forehead.",
            "Do NOT loosen or remove once applied.",
            "Improvised tourniquet: Use a 2-inch-wide strip of cloth + a stick (windlass). Never use wire or cord.",
            "Keep the patient warm and lying down."
          ],
          doList: ["Place above wound", "Tighten until bleeding stops", "Record the time", "Use wide material (2+ inches)"],
          dontList: ["Place over a joint", "Loosen once applied", "Use narrow cord/wire", "Delay — apply immediately"],
          ref: "tourniquet"
        }
      },
      junctional: {
        action: {
          title: "JUNCTIONAL BLEEDING — PACK AND PRESS",
          cls: "danger",
          steps: [
            "You CANNOT tourniquet the torso, neck, or groin. You must pack the wound.",
            "Pack the wound tightly with clean cloth, pushing material deep into the wound cavity.",
            "Apply maximum direct pressure on top of packing.",
            "Hold pressure for a minimum of 10 minutes. Do not let go.",
            "If available, use hemostatic (clotting) gauze.",
            "Maintain pressure and keep the patient in shock position (legs elevated)."
          ],
          doList: ["Pack wound cavity tightly", "Apply maximum pressure", "Hold for 10+ minutes", "Use hemostatic gauze if available"],
          dontList: ["Try to tourniquet the torso/neck", "Release pressure to check", "Leave wound unpacked"]
        }
      },
      head_bleed: {
        action: {
          title: "HEAD/FACE BLEEDING",
          cls: "warning",
          steps: [
            "Head wounds bleed heavily but are rarely life-threatening on their own.",
            "Apply firm pressure with clean cloth. Head wounds often need 15+ minutes of pressure.",
            "If skull fracture suspected (deformity, clear fluid from ears/nose): apply gentle pressure only — do not push on deformity.",
            "Keep the person sitting up slightly (30 degrees) if conscious and no spine injury suspected.",
            "Monitor for concussion signs: confusion, vomiting, unequal pupils, worsening headache."
          ],
          doList: ["Apply firm pressure", "Keep head elevated 30 degrees", "Monitor consciousness", "Check pupils regularly"],
          dontList: ["Push on skull deformities", "Let person sleep unsupervised after head injury", "Give blood thinners"]
        }
      }
    }
  },

  burns: {
    name: "BURNS",
    icon: "~",
    start: "source",
    nodes: {
      source: {
        q: "What caused the burn?",
        opts: [
          { label: "Heat (fire, hot liquid, steam, hot surface)", next: "thermal_assess" },
          { label: "Chemical (acid, alkali, cleaning product)", next: "chemical" },
          { label: "Electrical (wire, lightning, outlet)", next: "electrical" },
          { label: "Sunburn or radiation", next: "radiation" }
        ]
      },
      thermal_assess: {
        q: "How does the burn look?",
        opts: [
          { label: "Red, painful, no blisters (like sunburn)", next: "burn_first" },
          { label: "Blisters, very painful, red/mottled", next: "burn_second" },
          { label: "White, brown, or charred. Little or no pain", next: "burn_third" },
          { label: "Covers a large area (larger than patient's palm)", next: "burn_large" }
        ]
      },
      burn_first: {
        action: {
          title: "FIRST-DEGREE BURN (SUPERFICIAL)",
          steps: [
            "Cool under clean, cool (not cold) running water for 20 minutes.",
            "After cooling, apply aloe vera or moisturizer.",
            "Take ibuprofen or acetaminophen for pain if available.",
            "Cover loosely with a clean, non-stick bandage if needed.",
            "Should heal in 3-7 days without scarring."
          ],
          doList: ["Cool with running water 20 min", "Apply aloe/moisturizer", "Cover loosely", "Use pain relief"],
          dontList: ["Apply ice directly", "Use butter, oil, or toothpaste", "Break any small blisters"]
        }
      },
      burn_second: {
        action: {
          title: "SECOND-DEGREE BURN (PARTIAL THICKNESS)",
          cls: "warning",
          steps: [
            "Cool under clean, cool running water for 20 minutes minimum.",
            "Do NOT break blisters — they protect against infection.",
            "After cooling, cover with a non-stick sterile dressing.",
            "Wrap loosely with a bandage to hold dressing in place.",
            "Take pain medication if available.",
            "Change dressing daily. Watch for infection: increasing pain, redness, swelling, pus, fever.",
            "Seek advanced care if burn is on face, hands, feet, genitals, or over joints."
          ],
          doList: ["Cool 20+ minutes with water", "Leave blisters intact", "Cover with non-stick dressing", "Monitor for infection"],
          dontList: ["Pop blisters", "Apply adhesive bandages to burn", "Use ice", "Apply creams before cooling"]
        }
      },
      burn_third: {
        action: {
          title: "THIRD-DEGREE BURN — SEVERE",
          cls: "danger",
          steps: [
            "This burn has destroyed full skin thickness. It needs advanced care.",
            "Do NOT run under water — risk of hypothermia with large burns.",
            "Cover loosely with clean, dry, non-stick material (cling film works well).",
            "Elevate burned limbs above heart level if possible.",
            "Treat for SHOCK: lay flat, elevate legs, keep warm.",
            "Give small sips of water if conscious and able to swallow.",
            "Do NOT remove clothing stuck to the burn.",
            "Monitor breathing — burns to face/neck may cause airway swelling."
          ],
          doList: ["Cover with clean non-stick material", "Treat for shock", "Elevate burned area", "Monitor airway"],
          dontList: ["Remove stuck clothing", "Apply water to large 3rd-degree burns", "Apply any creams or ointments", "Give fluids to unconscious person"]
        }
      },
      burn_large: {
        action: {
          title: "LARGE AREA BURN — EMERGENCY",
          cls: "danger",
          steps: [
            "Any burn larger than the patient's palm is serious regardless of depth.",
            "Burns covering >10% body surface in adults or >5% in children are critical.",
            "Rule of 9s estimate: each arm=9%, each leg=18%, front torso=18%, back=18%, head=9%.",
            "Cover with clean, dry, non-stick material. Do not cool large burns (hypothermia risk).",
            "Begin oral rehydration if conscious: small frequent sips of water or ORS.",
            "Treat for shock: lay flat, elevate legs, keep warm with blankets.",
            "Monitor urine output if possible — dark or absent urine indicates dehydration.",
            "This person needs IV fluids and professional care urgently."
          ],
          doList: ["Cover loosely with clean material", "Oral fluids if conscious", "Keep warm", "Monitor urine output", "Estimate burn % with Rule of 9s"],
          dontList: ["Cool large burns with water", "Under-estimate burn severity", "Ignore signs of shock"]
        }
      },
      chemical: {
        action: {
          title: "CHEMICAL BURN",
          cls: "danger",
          steps: [
            "REMOVE contaminated clothing immediately (protect yourself — use gloves/barrier).",
            "FLUSH with large amounts of clean running water for 20-30 minutes minimum.",
            "For DRY chemicals: brush off powder BEFORE flushing with water.",
            "For eye exposure: flush eye continuously for 20+ minutes, lid held open.",
            "Do NOT try to neutralize (no vinegar on alkali, no baking soda on acid).",
            "After flushing, cover loosely with clean, dry dressing.",
            "Identify the chemical if possible (label, container) for future reference."
          ],
          doList: ["Remove contaminated clothing", "Flush 20-30 minutes with water", "Brush off dry chemicals first", "Identify the chemical"],
          dontList: ["Try to neutralize the chemical", "Use limited water (dilution worsens some chemicals)", "Touch chemical with bare hands"]
        }
      },
      electrical: {
        action: {
          title: "ELECTRICAL BURN",
          cls: "danger",
          steps: [
            "ENSURE the power source is OFF before touching the person. Do NOT become a second victim.",
            "Check breathing and pulse. Electrical injury can cause cardiac arrest.",
            "If not breathing: begin CPR immediately.",
            "Electrical burns are deeper than they appear — internal damage may be severe.",
            "There will be an entry AND exit wound. Look for both.",
            "Cover visible burns with clean, dry dressing.",
            "Monitor heart rhythm — arrhythmias can occur hours after electrical injury.",
            "Keep the person at rest. Do not allow exertion."
          ],
          doList: ["Ensure power is off first", "Check pulse and breathing", "Start CPR if needed", "Find entry AND exit wounds", "Monitor for hours"],
          dontList: ["Touch person while connected to power", "Assume small burns mean minor injury", "Let person be active"]
        }
      },
      radiation: {
        action: {
          title: "SUNBURN / RADIATION BURN",
          steps: [
            "Move to shade or indoors immediately.",
            "Cool the skin with damp cloths or cool (not cold) water.",
            "Apply aloe vera or moisturizing lotion liberally.",
            "Take ibuprofen for pain and inflammation.",
            "Drink extra water — sunburn increases dehydration.",
            "Do not break blisters if they form.",
            "Watch for heat illness signs: dizziness, nausea, rapid pulse, confusion."
          ],
          doList: ["Get out of sun", "Cool with damp cloths", "Hydrate aggressively", "Use aloe vera"],
          dontList: ["Apply ice", "Break blisters", "Continue sun exposure", "Ignore heat illness symptoms"]
        }
      }
    }
  },

  choking: {
    name: "CHOKING",
    icon: "!",
    start: "conscious",
    nodes: {
      conscious: {
        q: "Is the person conscious and able to respond?",
        opts: [
          { label: "Yes — coughing, gagging, or unable to speak", next: "cough_check" },
          { label: "No — unconscious or unresponsive", next: "unconscious_choke" }
        ]
      },
      cough_check: {
        q: "Can they cough forcefully?",
        opts: [
          { label: "Yes — coughing hard, some air movement", next: "encourage_cough" },
          { label: "No — silent, weak cough, turning blue, clutching throat", next: "heimlich" }
        ]
      },
      encourage_cough: {
        action: {
          title: "PARTIAL OBSTRUCTION — ENCOURAGE COUGHING",
          steps: [
            "Stay with the person and encourage them to keep coughing.",
            "Do NOT slap them on the back while they can still cough — it may worsen obstruction.",
            "If coughing becomes weak or stops, move to abdominal thrusts (Heimlich).",
            "Call for help if the obstruction does not clear within 1-2 minutes."
          ],
          doList: ["Encourage coughing", "Stay calm and stay with them", "Monitor for worsening"],
          dontList: ["Slap back while coughing effectively", "Give water", "Leave them alone"]
        }
      },
      heimlich: {
        action: {
          title: "COMPLETE OBSTRUCTION — ABDOMINAL THRUSTS",
          cls: "danger",
          steps: [
            "Stand behind the person. Wrap arms around their waist.",
            "Make a fist with one hand. Place thumb side against abdomen, above the navel and below the breastbone.",
            "Grab your fist with the other hand. Pull sharply INWARD and UPWARD.",
            "Repeat thrusts until the object is expelled or the person becomes unconscious.",
            "For PREGNANT or OBESE persons: use CHEST THRUSTS instead (hands on center of breastbone).",
            "For INFANTS (<1 year): Alternate 5 back blows (heel of hand between shoulder blades, face down) with 5 chest thrusts (two fingers on breastbone).",
            "If person becomes unconscious: lower to ground, begin CPR. Check mouth for object before each breath."
          ],
          doList: ["Stand behind, arms around waist", "Thrust inward and upward", "Repeat until cleared", "Use chest thrusts if pregnant/obese"],
          dontList: ["Use abdominal thrusts on infants", "Give up — keep trying", "Do blind finger sweeps in mouth"]
        }
      },
      unconscious_choke: {
        action: {
          title: "UNCONSCIOUS CHOKING — CPR PROTOCOL",
          cls: "danger",
          steps: [
            "Lower the person to the ground on their back.",
            "Open the airway: tilt head back, lift chin.",
            "Look in the mouth — if you can SEE an object, sweep it out with a finger. Do not do blind sweeps.",
            "Attempt 2 rescue breaths. If air does not go in, reposition head and try again.",
            "If breaths still blocked: begin chest compressions (30 compressions, 2 breaths).",
            "Check mouth after every 30 compressions for visible object.",
            "Continue CPR cycle until obstruction clears, help arrives, or person recovers."
          ],
          doList: ["Lower to ground", "Check mouth between cycles", "Give CPR: 30 compressions, 2 breaths", "Continue until resolved"],
          dontList: ["Do blind finger sweeps", "Give up", "Attempt Heimlich on unconscious person"]
        }
      }
    }
  },

  fractures: {
    name: "FRACTURES",
    icon: "/",
    start: "type",
    nodes: {
      type: {
        q: "What are you seeing?",
        opts: [
          { label: "Bone visible through skin or heavy deformity", next: "open_fracture" },
          { label: "Swelling, pain, unable to move — no bone visible", next: "closed_fracture" },
          { label: "Joint looks dislocated or out of place", next: "dislocation" },
          { label: "Sprain — painful but can still move somewhat", next: "sprain" }
        ]
      },
      open_fracture: {
        action: {
          title: "OPEN FRACTURE — BONE EXPOSED",
          cls: "danger",
          steps: [
            "Do NOT push the bone back in. Do NOT try to realign.",
            "Control bleeding: apply pressure AROUND the wound, not directly on exposed bone.",
            "Cover the wound and exposed bone with a clean, moist dressing (saline or clean water).",
            "Immobilize the limb in the position found. Splint above and below the fracture.",
            "Improvised splint: use sticks, boards, rolled magazines, or a pillow. Pad with cloth.",
            "Treat for shock: lay flat, elevate legs, keep warm.",
            "Monitor circulation below injury: check pulse, skin color, sensation in fingers/toes.",
            "This injury requires surgical care. Infection risk is high."
          ],
          doList: ["Cover bone with moist dressing", "Splint in position found", "Control bleeding around wound", "Check circulation below injury"],
          dontList: ["Push bone back in", "Try to straighten the limb", "Apply pressure on exposed bone", "Remove embedded objects"]
        }
      },
      closed_fracture: {
        action: {
          title: "CLOSED FRACTURE",
          cls: "warning",
          steps: [
            "Immobilize the injured area. Do not try to straighten or realign.",
            "Splint the limb: immobilize the joints ABOVE and BELOW the fracture site.",
            "Apply cold if available (wrapped in cloth, 20 min on / 20 min off).",
            "Elevate the injured limb if possible.",
            "Give pain relief if available (ibuprofen or acetaminophen).",
            "Check circulation below the fracture every 30 minutes: pulse, warmth, sensation, color.",
            "If fingers/toes become cold, blue, or numb: the splint is too tight — loosen slightly."
          ],
          doList: ["Splint above and below injury", "Apply cold packs wrapped in cloth", "Elevate the limb", "Check circulation regularly"],
          dontList: ["Try to straighten the bone", "Apply cold directly to skin", "Wrap splint too tightly", "Let person use the limb"]
        }
      },
      dislocation: {
        action: {
          title: "DISLOCATION",
          cls: "warning",
          steps: [
            "Do NOT attempt to pop the joint back in (risks nerve/blood vessel damage).",
            "Immobilize in the position found using a sling or splint.",
            "Apply cold wrapped in cloth to reduce swelling.",
            "For shoulder dislocation: support the arm with a sling against the body.",
            "For finger dislocation: buddy-tape to adjacent finger with padding between.",
            "Monitor circulation: check pulse, color, sensation beyond the joint.",
            "Give pain relief if available."
          ],
          doList: ["Immobilize in position found", "Apply cold", "Support with sling/splint", "Monitor circulation"],
          dontList: ["Try to relocate the joint", "Force movement", "Massage the area"]
        }
      },
      sprain: {
        action: {
          title: "SPRAIN — RICE PROTOCOL",
          steps: [
            "REST: Stop using the injured area. Avoid weight-bearing.",
            "ICE: Apply cold (wrapped in cloth) for 20 minutes on, 20 minutes off.",
            "COMPRESSION: Wrap with elastic bandage — firm but not tight. Check circulation.",
            "ELEVATION: Raise the injured area above heart level when possible.",
            "Take ibuprofen for pain and swelling if available.",
            "Begin gentle movement after 48-72 hours if pain allows.",
            "Seek further care if: unable to bear weight, severe swelling, numbness, or no improvement in 72 hours."
          ],
          doList: ["Rest the injury", "Ice 20 on / 20 off", "Compress with elastic wrap", "Elevate above heart"],
          dontList: ["Apply heat in first 48 hours", "Wrap too tightly", "Push through severe pain", "Ignore persistent symptoms"]
        }
      }
    }
  },

  dehydration: {
    name: "DEHYDRATION",
    icon: "~",
    start: "severity",
    nodes: {
      severity: {
        q: "What symptoms are present?",
        opts: [
          { label: "Thirsty, dry mouth, dark urine, mild headache", next: "mild_dehy" },
          { label: "Very dry mouth, little/no urine, dizziness, rapid heart rate", next: "moderate_dehy" },
          { label: "Confusion, no urine, sunken eyes, unable to drink, rapid weak pulse", next: "severe_dehy" },
          { label: "Vomiting or diarrhea is causing fluid loss", next: "gi_loss" }
        ]
      },
      mild_dehy: {
        action: {
          title: "MILD DEHYDRATION",
          steps: [
            "Drink small, frequent sips of water — 200ml every 15 minutes.",
            "If available, use oral rehydration solution (ORS) instead of plain water.",
            "DIY ORS recipe: 1 liter clean water + 6 level teaspoons sugar + 1/2 level teaspoon salt. Mix well.",
            "Rest in shade/cool area.",
            "Continue drinking until urine returns to pale yellow.",
            "Avoid caffeine and alcohol — they worsen dehydration."
          ],
          doList: ["Small frequent sips", "Use ORS if possible", "Rest in shade", "Monitor urine color"],
          dontList: ["Gulp large amounts at once", "Drink caffeine or alcohol", "Continue physical activity"]
        }
      },
      moderate_dehy: {
        action: {
          title: "MODERATE DEHYDRATION",
          cls: "warning",
          steps: [
            "Give ORS (or DIY: 1L water + 6 tsp sugar + 1/2 tsp salt) — 200-400ml per hour.",
            "If unable to keep fluids down, give very small amounts: 1 teaspoon every 1-2 minutes.",
            "Rest lying down in the coolest available area.",
            "Loosen or remove excess clothing.",
            "Monitor pulse, mental status, and urine output.",
            "Wet cloths on forehead, neck, and armpits if heat-related.",
            "If no improvement in 2 hours, or condition worsens: this is becoming severe."
          ],
          doList: ["ORS in small frequent amounts", "Rest lying down in cool area", "Monitor pulse and mental status", "Wet cloths for cooling"],
          dontList: ["Force large volumes", "Ignore worsening symptoms", "Allow physical activity"]
        }
      },
      severe_dehy: {
        action: {
          title: "SEVERE DEHYDRATION — CRITICAL",
          cls: "danger",
          steps: [
            "This person needs IV fluids. Oral rehydration alone may not be sufficient.",
            "If conscious and able to swallow: give ORS 1 teaspoon every minute, continuously.",
            "Position lying down with legs elevated slightly.",
            "Monitor breathing and consciousness continuously.",
            "Cool if overheated: wet sheets, fan, cool water on skin.",
            "If unconscious: place in recovery position (on side), monitor airway.",
            "Do NOT give fluids to an unconscious person.",
            "This is a medical emergency — seek any available advanced care."
          ],
          doList: ["Tiny continuous sips if conscious", "Legs elevated", "Cool if overheated", "Recovery position if unconscious"],
          dontList: ["Give fluids to unconscious person", "Delay seeking help", "Ignore altered mental status"]
        }
      },
      gi_loss: {
        action: {
          title: "FLUID LOSS FROM VOMITING/DIARRHEA",
          cls: "warning",
          steps: [
            "Primary goal: replace fluids faster than they're being lost.",
            "Wait 15-30 minutes after vomiting, then start ORS in very small amounts (1 tsp per minute).",
            "For diarrhea: give ORS after each loose stool — 200-400ml per episode.",
            "DIY ORS: 1 liter clean water + 6 level teaspoons sugar + 1/2 level teaspoon salt.",
            "BRAT diet when able to eat: Bananas, Rice, Applesauce, Toast.",
            "Monitor for dehydration: dry mouth, dark urine, dizziness, sunken eyes.",
            "Children dehydrate faster than adults — be more aggressive with ORS."
          ],
          doList: ["ORS after each episode", "Tiny amounts frequently", "BRAT diet when able", "Extra attention to children"],
          dontList: ["Give large drinks right after vomiting", "Use sports drinks as sole replacement (too much sugar)", "Ignore signs of worsening dehydration"]
        }
      }
    }
  },

  hypothermia: {
    name: "HYPOTHERMIA",
    icon: "*",
    start: "severity",
    nodes: {
      severity: {
        q: "What symptoms is the person showing?",
        opts: [
          { label: "Shivering, cold skin, alert but clumsy/confused", next: "mild_hypo" },
          { label: "Violent shivering or shivering stopped, very confused, slurred speech, drowsy", next: "moderate_hypo" },
          { label: "Unconscious, rigid muscles, very slow/absent pulse, appears dead", next: "severe_hypo" }
        ]
      },
      mild_hypo: {
        action: {
          title: "MILD HYPOTHERMIA",
          steps: [
            "Move to shelter immediately. Get out of wind and wet.",
            "Remove wet clothing and replace with dry layers.",
            "Insulate from the ground (sleeping pad, branches, cardboard — anything).",
            "Wrap in blankets, sleeping bag, or space blanket.",
            "Give warm, sweet drinks (NOT alcohol, NOT caffeine).",
            "Apply warmth to core: warm water bottles or heated cloths to neck, armpits, groin.",
            "Encourage gentle movement to generate body heat.",
            "Monitor — if shivering stops but person is still cold, this is worsening."
          ],
          doList: ["Remove from cold/wind/wet", "Dry clothes, insulate from ground", "Warm sweet drinks", "Warm the core (neck, armpits, groin)"],
          dontList: ["Give alcohol", "Rub or massage limbs", "Apply direct heat to skin (burn risk)", "Put in hot bath (cardiac risk)"]
        }
      },
      moderate_hypo: {
        action: {
          title: "MODERATE HYPOTHERMIA — HANDLE WITH CARE",
          cls: "warning",
          steps: [
            "Handle the person VERY GENTLY. Rough movement can cause cardiac arrest in hypothermia.",
            "Move to shelter. Remove wet clothing by cutting if needed (minimize movement).",
            "Insulate from the ground and wrap in layers — focus on retaining heat, not adding it quickly.",
            "Apply warm packs to core areas ONLY: neck, armpits, groin. Never to limbs.",
            "If conscious and able to swallow: warm, sweet drinks in small sips.",
            "Do NOT allow the person to walk or exert themselves.",
            "Body-to-body warming in a sleeping bag/blankets is effective.",
            "Monitor pulse and breathing closely — both will be slow."
          ],
          doList: ["Handle GENTLY", "Insulate and wrap", "Warm core only", "Body-to-body warming", "Monitor vitals"],
          dontList: ["Move roughly or allow walking", "Warm the limbs (cold blood rushes to heart)", "Give alcohol or caffeine", "Rub extremities"]
        }
      },
      severe_hypo: {
        action: {
          title: "SEVERE HYPOTHERMIA — LIFE THREAT",
          cls: "danger",
          steps: [
            "The person may appear dead. Check pulse for 60 full seconds — it may be very slow.",
            "Handle with EXTREME gentleness — the heart is very vulnerable to arrhythmia.",
            "If no pulse after 60 seconds: begin CPR. Continue even if seems futile.",
            "\"Nobody is dead until they are WARM and dead\" — do not stop resuscitation.",
            "Insulate from ground, wrap in all available layers.",
            "Apply gentle warmth to core only. Active rewarming must be slow.",
            "Do NOT give any fluids.",
            "Do NOT move the person more than absolutely necessary.",
            "Continue CPR and warming until the person recovers or advanced care is available."
          ],
          doList: ["Check pulse for 60 full seconds", "Handle with extreme care", "Begin CPR if no pulse", "Insulate and warm core slowly"],
          dontList: ["Declare death in the field", "Stop CPR — continue until warm", "Move roughly", "Give fluids", "Apply rapid heat"]
        }
      }
    }
  },

  heatillness: {
    name: "HEAT ILLNESS",
    icon: "^",
    start: "severity",
    nodes: {
      severity: {
        q: "What symptoms are present?",
        opts: [
          { label: "Heavy sweating, cramps, tiredness, dizziness, headache", next: "heat_exhaustion" },
          { label: "Hot/dry skin (no sweating), confusion, seizures, unconscious, temp >104F/40C", next: "heat_stroke" }
        ]
      },
      heat_exhaustion: {
        action: {
          title: "HEAT EXHAUSTION",
          cls: "warning",
          steps: [
            "Move to the coolest available area immediately (shade, indoors).",
            "Lay person down and elevate legs slightly.",
            "Remove excess clothing.",
            "Cool actively: wet cloths on neck, armpits, groin. Fan if possible.",
            "Give cool water or ORS to drink — small frequent sips.",
            "Muscle cramps: gentle stretching and massage, give salted water.",
            "If no improvement in 30 minutes, or condition worsens: treat as heat stroke."
          ],
          doList: ["Move to cool area", "Lie down, elevate legs", "Cool with wet cloths", "Hydrate with ORS/water"],
          dontList: ["Continue any activity", "Give ice-cold water (stomach cramps)", "Ignore worsening symptoms"]
        }
      },
      heat_stroke: {
        action: {
          title: "HEAT STROKE — LIFE-THREATENING EMERGENCY",
          cls: "danger",
          steps: [
            "This is a MEDICAL EMERGENCY. Brain damage and death can occur rapidly.",
            "COOL IMMEDIATELY by any means available:",
            "Immerse in cool/cold water if possible (most effective).",
            "If no immersion: soak sheets in water and wrap the person, fan continuously.",
            "Apply ice or cold packs to neck, armpits, and groin.",
            "Spray/pour water on skin and fan vigorously.",
            "If conscious: give small sips of cool water.",
            "If unconscious: recovery position, monitor airway, do NOT give fluids.",
            "Continue cooling until temperature drops below 102F/39C or person improves.",
            "Monitor breathing and pulse — begin CPR if needed."
          ],
          doList: ["Cool by ANY means immediately", "Ice to neck/armpits/groin", "Wet sheets + fanning", "Monitor temperature"],
          dontList: ["Delay cooling for any reason", "Give fluids to unconscious person", "Give aspirin or acetaminophen (won't work for heat stroke)", "Stop cooling too early"]
        }
      }
    }
  },

  allergic: {
    name: "ALLERGIC RXNS",
    icon: "!",
    start: "severity",
    nodes: {
      severity: {
        q: "What symptoms are present?",
        opts: [
          { label: "Itching, hives, localized swelling — breathing is normal", next: "mild_allergy" },
          { label: "Swelling of face/throat, difficulty breathing, wheezing, widespread hives", next: "anaphylaxis" },
          { label: "Collapse, unable to breathe, loss of consciousness", next: "anaph_severe" }
        ]
      },
      mild_allergy: {
        action: {
          title: "MILD ALLERGIC REACTION",
          steps: [
            "Remove the allergen if possible (stop eating food, remove stinger, move away from cause).",
            "For insect stinger: scrape sideways with card edge. Do not squeeze with tweezers.",
            "Give antihistamine (diphenhydramine/Benadryl) if available: 25-50mg for adults.",
            "Apply cool cloth to itchy/swollen areas.",
            "Monitor for 2-4 hours — mild reactions can escalate to anaphylaxis.",
            "If breathing difficulty, throat swelling, or dizziness develops: treat as anaphylaxis immediately."
          ],
          doList: ["Remove allergen", "Give antihistamine", "Cool cloth on affected areas", "Monitor for 2-4 hours"],
          dontList: ["Squeeze insect stingers", "Ignore worsening symptoms", "Assume it will stay mild"]
        }
      },
      anaphylaxis: {
        action: {
          title: "ANAPHYLAXIS — EMERGENCY",
          cls: "danger",
          steps: [
            "Use EPINEPHRINE AUTO-INJECTOR (EpiPen) immediately if available:",
            "Inject into outer mid-thigh — can inject through clothing. Hold 10 seconds.",
            "If no EpiPen: this is a dire emergency. Seek any medical resource.",
            "Position: If breathing difficulty — sit upright. If faint/dizzy — lay flat, elevate legs.",
            "If both: lay flat is preferred (blood pressure is the bigger threat).",
            "Give antihistamine (Benadryl 50mg) as supplement, NOT as replacement for epinephrine.",
            "A second EpiPen dose may be needed after 5-15 minutes if symptoms return.",
            "Monitor breathing continuously. Be prepared to give CPR.",
            "Even if symptoms improve with EpiPen, person needs monitoring for 4-6 hours (biphasic reaction)."
          ],
          doList: ["EpiPen to outer thigh immediately", "Sit up if breathing trouble", "Lay flat if faint", "Give second dose at 5-15 min if needed"],
          dontList: ["Delay epinephrine", "Rely on antihistamine alone", "Let person stand or walk", "Assume one EpiPen dose is enough"]
        }
      },
      anaph_severe: {
        action: {
          title: "SEVERE ANAPHYLAXIS WITH COLLAPSE",
          cls: "danger",
          steps: [
            "Give EPINEPHRINE immediately if available (EpiPen to outer thigh).",
            "If not breathing: begin CPR. 30 chest compressions, 2 rescue breaths.",
            "If airway is swollen shut, rescue breaths may not work — focus on compressions.",
            "Lay person flat. Elevate legs 12 inches.",
            "If EpiPen used and person recovers: keep lying flat, monitor closely.",
            "A second EpiPen dose may be given after 5 minutes if no improvement.",
            "Continue CPR until person recovers or help arrives.",
            "Do NOT stop CPR even if it seems futile — epinephrine may take minutes to work."
          ],
          doList: ["EpiPen immediately", "CPR if not breathing", "Lay flat, legs elevated", "Continue CPR persistently"],
          dontList: ["Delay epinephrine for any reason", "Stop CPR", "Sit person up if unconscious", "Give oral medications to unconscious person"]
        }
      }
    }
  },

  shock: {
    name: "SHOCK",
    icon: "!",
    start: "signs",
    nodes: {
      signs: {
        q: "What signs do you see?",
        opts: [
          { label: "Pale/grey skin, rapid weak pulse, rapid breathing, confused or anxious", next: "shock_treat" },
          { label: "After a severe allergic reaction", next: "shock_anaph" },
          { label: "After severe burn or crush injury", next: "shock_burn" },
          { label: "Not sure — person just 'doesn't look right' after an injury", next: "shock_assess" }
        ]
      },
      shock_assess: {
        q: "Check these signs. Which apply?",
        opts: [
          { label: "Pulse is fast (>100/min) and feels weak/thready", next: "shock_treat" },
          { label: "Skin is pale, cool, and clammy", next: "shock_treat" },
          { label: "Person is confused, restless, or unusually quiet", next: "shock_treat" },
          { label: "None of these — person seems stable", next: "shock_monitor" }
        ]
      },
      shock_treat: {
        action: {
          title: "SHOCK — TREAT IMMEDIATELY",
          cls: "danger",
          steps: [
            "Lay the person FLAT on their back.",
            "Elevate legs 12 inches (use a pack, rolled clothing, or any support).",
            "EXCEPTION: If head/chest injury or breathing difficulty — keep flat or slightly upright.",
            "Treat the CAUSE: stop bleeding, cover burns, immobilize fractures.",
            "Keep the person WARM — cover with blankets, coats, space blanket. Insulate from ground.",
            "Loosen tight clothing (belt, collar, boots).",
            "Give small sips of water ONLY if conscious, alert, and no abdominal injury.",
            "Do NOT give food.",
            "Talk to the person — keep them calm and reassured.",
            "Monitor pulse, breathing, and consciousness every 5 minutes."
          ],
          doList: ["Lay flat, legs elevated", "Treat the underlying cause", "Keep warm", "Monitor vitals every 5 min", "Reassure the person"],
          dontList: ["Let them sit or stand", "Give food", "Give fluids if abdominal injury", "Leave them alone", "Elevate legs if head/spine injury"]
        }
      },
      shock_anaph: {
        action: {
          title: "ANAPHYLACTIC SHOCK",
          cls: "danger",
          steps: [
            "Give EPINEPHRINE (EpiPen) immediately — this is the only effective treatment.",
            "Lay flat with legs elevated UNLESS breathing difficulty (then semi-upright).",
            "If not breathing: CPR immediately.",
            "Give second EpiPen at 5-15 minutes if no improvement.",
            "Antihistamine (Benadryl 50mg) as supplement only.",
            "Monitor continuously — anaphylaxis can return hours later (biphasic reaction).",
            "See the ALLERGIC REACTIONS triage for full protocol."
          ],
          doList: ["EpiPen immediately", "Lay flat, legs up", "CPR if needed", "Monitor for hours"],
          dontList: ["Rely on antihistamine alone", "Delay epinephrine", "Let person walk"]
        }
      },
      shock_burn: {
        action: {
          title: "SHOCK FROM BURNS / CRUSH INJURY",
          cls: "danger",
          steps: [
            "Massive fluid loss causes shock in severe burns and crush injuries.",
            "Lay flat, elevate legs (unless burns to legs prevent this).",
            "Begin oral rehydration immediately if conscious: ORS or water, small frequent sips.",
            "DIY ORS: 1L water + 6 tsp sugar + 1/2 tsp salt.",
            "Target: adult needs ~250ml/hour for serious burns.",
            "Keep warm — burned patients lose heat rapidly.",
            "Cover burns with clean dry material. See BURNS triage for wound management.",
            "Monitor urine output if possible — dark or absent urine = worsening.",
            "This person needs IV fluids urgently."
          ],
          doList: ["Oral rehydration aggressively", "Lay flat, keep warm", "Cover burns", "Monitor urine output"],
          dontList: ["Under-hydrate", "Cool large burns with water (hypothermia)", "Ignore declining mental status"]
        }
      },
      shock_monitor: {
        action: {
          title: "STABLE — MONITOR CLOSELY",
          steps: [
            "The person appears stable now, but shock can develop over time.",
            "Have them lie down and rest. Elevate legs slightly as a precaution.",
            "Check pulse rate and quality every 15 minutes.",
            "Watch for: increasing pulse rate, pallor, confusion, restlessness, cool/clammy skin.",
            "Keep warm and comfortable.",
            "Give water in small sips if no abdominal injury.",
            "If ANY shock signs develop, begin full shock treatment immediately."
          ],
          doList: ["Rest lying down", "Monitor vitals every 15 min", "Keep warm", "Have treatment plan ready"],
          dontList: ["Assume they're fine", "Let them be active", "Stop monitoring"]
        }
      }
    }
  },

  wounds: {
    name: "WOUND CARE",
    icon: "x",
    start: "type",
    nodes: {
      type: {
        q: "What type of wound?",
        opts: [
          { label: "Clean cut (knife, glass, sharp edge)", next: "laceration" },
          { label: "Puncture wound (nail, thorn, bite)", next: "puncture" },
          { label: "Scrape or abrasion (road rash, friction)", next: "abrasion" },
          { label: "Wound showing signs of infection (red, swollen, pus, hot)", next: "infection" }
        ]
      },
      laceration: {
        action: {
          title: "LACERATION — CLEAN CUT",
          steps: [
            "Control bleeding with direct pressure first (see BLEEDING triage if severe).",
            "Clean the wound with large amounts of clean water. Irrigate thoroughly.",
            "Remove visible debris gently. Do NOT dig for embedded objects.",
            "Assess if wound edges can be brought together (this promotes faster healing).",
            "Closure options: butterfly strips (Steri-Strips), clean tape, or suture if trained.",
            "Apply thin layer of antibiotic ointment if available.",
            "Cover with sterile non-stick dressing.",
            "Change dressing daily and inspect for infection signs.",
            "Deep cuts over joints, tendons, or with numbness/weakness need advanced care."
          ],
          doList: ["Irrigate thoroughly with water", "Close edges if possible (strips/tape)", "Apply antibiotic ointment", "Change dressing daily"],
          dontList: ["Use hydrogen peroxide (damages tissue)", "Close dirty or bite wounds (trap bacteria)", "Ignore deep cuts over joints/tendons"]
        }
      },
      puncture: {
        action: {
          title: "PUNCTURE WOUND",
          cls: "warning",
          steps: [
            "Puncture wounds carry high infection and tetanus risk.",
            "Let the wound bleed freely for a few minutes (helps flush bacteria).",
            "Clean around the wound with soap and water.",
            "Irrigate the puncture with clean water using a syringe if available (pressure flush).",
            "Do NOT close puncture wounds — they need to drain from inside out.",
            "Apply antibiotic ointment and a loose dressing.",
            "Watch closely for infection: increasing redness, swelling, warmth, red streaks, pus, fever.",
            "Animal bites: HIGH infection risk. Clean aggressively. Monitor closely.",
            "Tetanus concern: any deep puncture from dirty object warrants tetanus consideration."
          ],
          doList: ["Let bleed briefly to flush", "Irrigate with pressure", "Leave open (do not close)", "Monitor closely for infection"],
          dontList: ["Close or suture puncture wounds", "Ignore animal bites", "Skip cleaning because it's 'just a small hole'"]
        }
      },
      abrasion: {
        action: {
          title: "ABRASION — SCRAPE",
          steps: [
            "Clean the area gently with clean water and mild soap.",
            "Remove dirt and debris with a clean cloth — scrubbing may be needed but be gentle.",
            "Embedded gravel/dirt must be removed to prevent 'tattoo' scarring.",
            "Apply thin layer of antibiotic ointment.",
            "Cover with non-stick dressing. A moist healing environment heals faster.",
            "Large abrasions: apply petroleum jelly or antibiotic ointment liberally to prevent dressing from sticking.",
            "Change dressing daily. Expect clear/yellow fluid (normal healing) — pus and redness are not.",
            "Most abrasions heal in 7-14 days."
          ],
          doList: ["Clean thoroughly — remove all debris", "Antibiotic ointment", "Non-stick moist dressing", "Change daily"],
          dontList: ["Leave dirt embedded", "Let large abrasions dry out (slower healing)", "Use alcohol or iodine on open abrasions"]
        }
      },
      infection: {
        action: {
          title: "WOUND INFECTION",
          cls: "warning",
          steps: [
            "Signs of infection: increasing redness, swelling, warmth, pain, pus, red streaks from wound, fever.",
            "RED STREAKS traveling away from wound = spreading infection (lymphangitis) — this is urgent.",
            "Open the wound if it was closed — infection needs to drain.",
            "Clean with water or saline. Gently express pus if present.",
            "Apply warm, moist compresses for 20 minutes, 3-4 times per day.",
            "If antibiotics are available: start a course (this is one of few field situations where oral antibiotics are critical).",
            "Elevate the infected area.",
            "Mark the border of redness with a pen — if it expands, infection is worsening.",
            "Fever + red streaks + rapid pulse = sepsis risk. This is life-threatening without antibiotics."
          ],
          doList: ["Open closed infected wounds to drain", "Warm compresses 3-4x daily", "Mark redness borders", "Use antibiotics if available", "Elevate the area"],
          dontList: ["Re-close infected wounds", "Ignore red streaks (sign of spreading)", "Delay antibiotics if available", "Assume it will resolve without treatment"]
        }
      }
    }
  }
};

// === TRIAGE UI ENGINE ===
let triageHistory = [];
let triageCurrentTree = null;

function triageShowCategories() {
  const catPanel = document.querySelector('#module-medical .triage-categories');
  const flowPanel = document.querySelector('#module-medical .triage-flow');
  catPanel.style.display = '';
  flowPanel.classList.remove('active');
  triageHistory = [];
  triageCurrentTree = null;
}

function triageStart(treeKey) {
  triageCurrentTree = treeKey;
  triageHistory = [];
  const tree = TRIAGE_TREES[treeKey];
  triageNavigate(tree.start);
}

function triageNavigate(nodeId) {
  const tree = TRIAGE_TREES[triageCurrentTree];
  const node = tree.nodes[nodeId];

  // Show flow panel, hide categories
  const catPanel = document.querySelector('#module-medical .triage-categories');
  const flowPanel = document.querySelector('#module-medical .triage-flow');
  catPanel.style.display = 'none';
  flowPanel.classList.add('active');

  // Update header
  document.getElementById('triage-flow-title').textContent = tree.name;

  // Track history for back navigation
  triageHistory.push(nodeId);

  // Update breadcrumb
  const crumbEl = document.getElementById('triage-breadcrumb');
  let crumbHtml = '<span class="triage-crumb" onclick="triageShowCategories()">TRIAGE</span>';
  triageHistory.forEach((nid, i) => {
    const n = tree.nodes[nid];
    const label = n.q ? n.q.substring(0, 25) + '...' : (n.action ? n.action.title.substring(0, 25) : nid);
    if (i < triageHistory.length - 1) {
      crumbHtml += '<span class="triage-crumb" onclick="triageGoBack(' + i + ')">' + esc(label) + '</span>';
    } else {
      crumbHtml += '<span class="triage-crumb">' + esc(label) + '</span>';
    }
  });
  crumbEl.innerHTML = crumbHtml;

  // Render node
  const bodyEl = document.getElementById('triage-flow-body');

  if (node.q) {
    // Question node
    let html = '<div class="triage-question">';
    html += '<div class="triage-q-text">' + esc(node.q) + '</div>';
    html += '<div class="triage-options">';
    node.opts.forEach(opt => {
      html += '<div class="triage-opt-btn" onclick="triageNavigate(\'' + opt.next + '\')">' + esc(opt.label) + '</div>';
    });
    html += '</div></div>';
    bodyEl.innerHTML = html;
  } else if (node.action) {
    // Action node
    const a = node.action;
    let cls = a.cls ? ' ' + a.cls : '';
    let html = '<div class="triage-action' + cls + '">';
    html += '<div class="triage-action-title">' + esc(a.title) + '</div>';
    html += '<div class="triage-action-body"><ol>';
    a.steps.forEach(s => {
      html += '<li>' + esc(s) + '</li>';
    });
    html += '</ol></div>';

    if (a.doList || a.dontList) {
      html += '<div class="triage-do-dont">';
      if (a.doList) {
        html += '<div class="triage-do"><div class="triage-do-title">DO</div><ul>';
        a.doList.forEach(d => { html += '<li>' + esc(d) + '</li>'; });
        html += '</ul></div>';
      }
      if (a.dontList) {
        html += '<div class="triage-dont"><div class="triage-dont-title">DO NOT</div><ul>';
        a.dontList.forEach(d => { html += '<li>' + esc(d) + '</li>'; });
        html += '</ul></div>';
      }
      html += '</div>';
    }

    if (a.ref) {
      html += '<div class="triage-ref">';
      html += '<span class="triage-ref-btn" onclick="triageLookup(\'' + esc(a.ref) + '\')">[ SEARCH KB: ' + esc(a.ref).toUpperCase() + ' ]</span>';
      html += '</div>';
    }

    html += '</div>';
    bodyEl.innerHTML = html;
  }

  bodyEl.scrollTop = 0;
}

function triageGoBack(index) {
  triageHistory = triageHistory.slice(0, index);
  const nodeId = triageHistory.length > 0 ? triageHistory.pop() : TRIAGE_TREES[triageCurrentTree].start;
  triageNavigate(nodeId);
}

function triageBack() {
  if (triageHistory.length <= 1) {
    triageShowCategories();
    return;
  }
  triageHistory.pop(); // remove current
  const prevNode = triageHistory.pop(); // get previous (will be re-pushed by navigate)
  triageNavigate(prevNode);
}

// Look up a topic in the knowledge base
function triageLookup(term) {
  // Switch to knowledge module, library tab, and search
  switchModule('knowledge');
  switchKnowledgeTab('library');
  document.getElementById('library-search').value = term;
  librarySearch();
}
