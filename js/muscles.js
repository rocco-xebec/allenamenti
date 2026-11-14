// Gruppi muscolari e mappatura automatica esercizio -> muscoli (1 = primario, 0.5 = secondario).
export const MUSCLES = [
  'quadricipiti', 'glutei', 'adduttori', 'femorali', 'polpacci', 'lombari', 'addome', 'obliqui',
  'petto', 'dorsali', 'schiena alta', 'trapezi', 'spalle', 'bicipiti', 'tricipiti', 'avambracci',
];

const RULES = [
  [/hack squat/, { quadricipiti: 1, glutei: 0.5, adduttori: 0.5 }],
  [/bulgarian|split squat|affondi|lunge/, { quadricipiti: 1, glutei: 1, adduttori: 0.5 }],
  [/front squat/, { quadricipiti: 1, glutei: 0.5, addome: 0.5 }],
  [/squat/, { quadricipiti: 1, glutei: 1, adduttori: 0.5, lombari: 0.5 }],
  [/rdl|rumen|stiff|stacco rumeno|good morning/, { femorali: 1, glutei: 1, lombari: 0.5 }],
  [/stacc|deadlift/, { glutei: 1, femorali: 1, lombari: 1, quadricipiti: 0.5, trapezi: 0.5, avambracci: 0.5 }],
  [/leg press|pressa/, { quadricipiti: 1, glutei: 0.5, adduttori: 0.5 }],
  [/wrist|polso|forearm/, { avambracci: 1 }],
  [/leg extension|extension/, { quadricipiti: 1 }],
  [/leg curl|curl femorali|nordic/, { femorali: 1 }],
  [/step.?up/, { quadricipiti: 1, glutei: 1 }],
  [/hip thrust|glute bridge|ponte/, { glutei: 1, femorali: 0.5 }],
  [/adductor|adduttor/, { adduttori: 1 }],
  [/abductor|abduttor/, { glutei: 1 }],
  [/calf|polpacc/, { polpacci: 1 }],
  [/incline.*press|panca inclinata/, { petto: 1, spalle: 0.5, tricipiti: 0.5 }],
  [/bench|panca|chest press|push.?up|piegament|dip/, { petto: 1, tricipiti: 0.5, spalle: 0.5 }],
  [/overhead|military|shoulder press|lento avanti|arnold/, { spalle: 1, tricipiti: 0.5, addome: 0.5 }],
  [/lateral raise|alzate laterali/, { spalle: 1 }],
  [/face pull|pull.?apart|reverse fly|rotazion/, { 'schiena alta': 1, spalle: 0.5 }],
  [/pulldown|lat machine|pull.?up|trazion|chin/, { dorsali: 1, bicipiti: 0.5, 'schiena alta': 0.5 }],
  [/row|rematore|pulley/, { 'schiena alta': 1, dorsali: 1, bicipiti: 0.5 }],
  [/shrug|scrollate/, { trapezi: 1 }],
  [/farmer|carry|carries|walk/, { avambracci: 1, trapezi: 1, addome: 0.5 }],
  [/wrist|polso|forearm/, { avambracci: 1 }],
  [/curl/, { bicipiti: 1, avambracci: 0.5 }],
  [/tricep|pushdown|french|skull/, { tricipiti: 1 }],
  [/woodchop|russian twist|rotation/, { obliqui: 1, addome: 0.5 }],
  [/pallof|anti.?rot/, { addome: 1, obliqui: 1 }],
  [/knee raise|leg raise|crunch|plank|ab wheel|hollow|captain/, { addome: 1 }],
];

export function guessMuscles(name) {
  const s = (name || '').toLowerCase();
  for (const [re, m] of RULES) if (re.test(s)) return { ...m };
  return {};
}
