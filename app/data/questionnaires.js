// The three questionnaires the MRSS2.0 needs: ACL-RSI, IKDC Subjective Knee
// Evaluation, and TSK-11. Item text and scoring follow the Melbourne guide.

export const ACL_RSI = {
  id: 'aclrsi',
  name: 'ACL-RSI',
  scale: 'slider0100',
  note: 'Answer each 0–100. Your score is the average. The MRSS awards 10/10 for >90%, otherwise 0.',
  items: [
    { q: 'Are you confident that you can perform at your previous level of sport participation?', lo: 'Not at all confident', hi: 'Fully confident' },
    { q: 'Do you think you are likely to re-injure your knee by participating in your sport?', lo: 'Extremely likely', hi: 'Not likely at all' },
    { q: 'Are you nervous about playing your sport?', lo: 'Extremely nervous', hi: 'Not nervous at all' },
    { q: 'Are you confident that your knee will not give way by playing your sport?', lo: 'Not at all confident', hi: 'Fully confident' },
    { q: 'Are you confident that you could play your sport without concern for your knee?', lo: 'Not at all confident', hi: 'Fully confident' },
    { q: 'Do you find it frustrating to have to consider your knee with respect to your sport?', lo: 'Extremely frustrating', hi: 'Not at all frustrating' },
    { q: 'Are you fearful of re-injuring your knee by playing your sport?', lo: 'Extremely fearful', hi: 'No fear at all' },
    { q: 'Are you confident about your knee holding up under pressure?', lo: 'Not at all confident', hi: 'Fully confident' },
    { q: 'Are you afraid of accidentally injuring your knee by playing your sport?', lo: 'Extremely afraid', hi: 'Not at all afraid' },
    { q: 'Do thoughts of having to go through surgery and rehabilitation prevent you from playing your sport?', lo: 'All of the time', hi: 'None of the time' },
    { q: 'Are you confident about your ability to perform well at your sport?', lo: 'Not at all confident', hi: 'Fully confident' },
    { q: 'Do you feel relaxed about playing your sport?', lo: 'Not at all relaxed', hi: 'Fully relaxed' },
  ],
};

export const TSK11 = {
  id: 'tsk11',
  name: 'TSK-11 (Tampa Scale of Kinesiophobia)',
  note: 'Each item 1–4. Total 11–18 = pass. 19 or more = fail — the guide says not to continue MRSS testing on a fail.',
  choices: [
    [1, 'Strongly disagree'],
    [2, 'Somewhat disagree'],
    [3, 'Somewhat agree'],
    [4, 'Strongly agree'],
  ],
  items: [
    "I'm afraid that I might injure myself if I exercise.",
    'If I were to try to overcome it, my pain would increase.',
    'My body is telling me I have something dangerously wrong.',
    "People aren't taking my medical condition seriously enough.",
    'My accident has put my body at risk for the rest of my life.',
    'Pain always means I have injured my body.',
    'Simply being careful that I do not make any unnecessary movements is the safest thing I can do to prevent my pain from worsening.',
    "I wouldn't have this much pain if there weren't something potentially dangerous going on in my body.",
    'Pain lets me know when to stop exercising so that I do not injure myself.',
    "I can't do all the things normal people do because it's too easy for me to get injured.",
    'No one should have to exercise when he/she is in pain.',
  ],
};

const ACTIVITY = [
  [4, 'Very strenuous activities like jumping or pivoting as in basketball or soccer'],
  [3, 'Strenuous activities like heavy physical work, skiing or tennis'],
  [2, 'Moderate activities like moderate physical work, running or jogging'],
  [1, 'Light activities like walking, housework or yard work'],
  [0, 'Unable to perform any of the above activities'],
];

const DIFFICULTY = [
  [4, 'Not difficult at all'],
  [3, 'Minimally difficult'],
  [2, 'Moderately difficult'],
  [1, 'Extremely difficult'],
  [0, 'Unable to do'],
];

export const IKDC = {
  id: 'ikdc',
  name: 'IKDC Subjective Knee Evaluation',
  note: 'Score = sum of items ÷ 87 × 100. Item 10a (function before the injury) is recorded but not scored. The MRSS awards raw score ÷ 10.',
  maxTotal: 87,
  items: [
    { id: 'q1', max: 4, q: 'What is the highest level of activity you can perform without significant knee pain?', choices: ACTIVITY },
    { id: 'q2', max: 10, q: 'During the past 4 weeks, how often have you had pain?', scale: { lo: 'Constant', hi: 'Never' } },
    { id: 'q3', max: 10, q: 'If you have pain, how severe is it?', scale: { lo: 'Worst pain imaginable', hi: 'No pain' } },
    { id: 'q4', max: 4, q: 'During the past 4 weeks, how stiff or swollen was your knee?', choices: [[4, 'Not at all'], [3, 'Mildly'], [2, 'Moderately'], [1, 'Very'], [0, 'Extremely']] },
    { id: 'q5', max: 4, q: 'What is the highest level of activity you can perform without significant swelling in your knee?', choices: ACTIVITY },
    { id: 'q6', max: 1, q: 'During the past 4 weeks, did your knee lock or catch?', choices: [[1, 'No'], [0, 'Yes']] },
    { id: 'q7', max: 4, q: 'What is the highest level of activity you can perform without significant giving way in your knee?', choices: ACTIVITY },
    { id: 'q8', max: 4, q: 'What is the highest level of activity you can participate in on a regular basis?', choices: ACTIVITY },
    { id: 'q9a', max: 4, group: 'How does your knee affect your ability to:', q: 'Go up stairs', choices: DIFFICULTY },
    { id: 'q9b', max: 4, q: 'Go down stairs', choices: DIFFICULTY },
    { id: 'q9c', max: 4, q: 'Kneel on the front of your knee', choices: DIFFICULTY },
    { id: 'q9d', max: 4, q: 'Squat', choices: DIFFICULTY },
    { id: 'q9e', max: 4, q: 'Sit with your knee bent', choices: DIFFICULTY },
    { id: 'q9f', max: 4, q: 'Rise from a chair', choices: DIFFICULTY },
    { id: 'q9g', max: 4, q: 'Run straight ahead', choices: DIFFICULTY },
    { id: 'q9h', max: 4, q: 'Jump and land on your involved leg', choices: DIFFICULTY },
    { id: 'q9i', max: 4, q: 'Stop and start quickly', choices: DIFFICULTY },
    { id: 'q10b', max: 10, q: 'Current function of your knee', scale: { lo: "Can't perform daily activities", hi: 'No limitation in daily activities' } },
  ],
  unscored: [
    { id: 'q10a', max: 10, q: 'Function prior to your knee injury (recorded, not scored)', scale: { lo: "Couldn't perform daily activities", hi: 'No limitation in daily activities' } },
  ],
};

export function scoreAclRsi(answers) {
  const vals = ACL_RSI.items.map((_, i) => answers?.[i]).filter((v) => typeof v === 'number');
  if (vals.length !== ACL_RSI.items.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function scoreTsk11(answers) {
  const vals = TSK11.items.map((_, i) => answers?.[i]).filter((v) => typeof v === 'number');
  if (vals.length !== TSK11.items.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

export function scoreIkdc(answers) {
  let sum = 0;
  let maxPossible = 0;
  let answered = 0;
  for (const item of IKDC.items) {
    const v = answers?.[item.id];
    if (typeof v === 'number') {
      sum += v;
      maxPossible += item.max;
      answered += 1;
    }
  }
  // The guide allows scoring with up to two missing items, using the
  // maximum possible sum of the completed items.
  if (answered < IKDC.items.length - 2) return null;
  if (maxPossible === 0) return null;
  return { score: (sum / maxPossible) * 100, sum, maxPossible, answered };
}
