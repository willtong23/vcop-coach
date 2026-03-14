/**
 * Genre Templates for Guided Writing Mode
 * Each genre defines a structure of sections with prompts at 3 scaffolding levels.
 */

export const GENRE_TEMPLATES = {
  narrative: {
    name: 'Narrative',
    sections: [
      {
        id: 'hook',
        name: 'Hook',
        description: 'Grab the reader',
        sentenceCount: { min: 1, max: 1 },
        prompts: {
          1: 'Start with something that grabs the reader — a sound, a question, or a dramatic moment. What is the first thing the reader hears or sees?',
          2: 'Open your story with a hook. Try starting with a sound, a question, or a dramatic moment.',
          3: 'Write your opening hook.'
        },
        sentenceStarters: ['Suddenly, ', '"CRASH!" ', 'Have you ever ', 'It was the kind of day when ']
      },
      {
        id: 'setting',
        name: 'Setting',
        description: 'Where and when',
        sentenceCount: { min: 1, max: 2 },
        prompts: {
          1: 'Now describe where you are. What can you see around you? What does the place look like?',
          2: 'Set the scene. Where and when does your story take place?',
          3: 'Establish your setting.'
        },
        sentenceStarters: ['The ', 'Around me, ', 'It was a ', 'In the distance, ']
      },
      {
        id: 'buildup',
        name: 'Build-up',
        description: 'Build tension',
        sentenceCount: { min: 2, max: 3 },
        prompts: {
          1: 'What happens next? Start building the tension. What does your character do or notice?',
          2: 'Build up the tension. What starts to happen?',
          3: 'Develop the narrative tension.'
        },
        sentenceStarters: ['I noticed ', 'Without warning, ', 'As I got closer, ', 'My heart began to ']
      },
      {
        id: 'problem',
        name: 'Problem',
        description: 'The exciting moment',
        sentenceCount: { min: 2, max: 3 },
        prompts: {
          1: 'This is the most exciting part! What goes wrong? What is the big problem or surprise?',
          2: 'Now the main event. What is the problem or climax?',
          3: 'Write the climax of your story.'
        },
        sentenceStarters: ['To my horror, ', 'That was when ', 'Everything changed when ', 'I could not believe ']
      },
      {
        id: 'resolution',
        name: 'Resolution',
        description: 'How it is solved',
        sentenceCount: { min: 1, max: 2 },
        prompts: {
          1: 'How does the problem get solved? What does your character do to fix things?',
          2: 'Resolve the problem. What happens to make things better?',
          3: 'Write the resolution.'
        },
        sentenceStarters: ['Finally, ', 'With one last effort, ', 'Luckily, ', 'After what felt like hours, ']
      },
      {
        id: 'ending',
        name: 'Ending',
        description: 'Reflection or twist',
        sentenceCount: { min: 1, max: 1 },
        prompts: {
          1: 'End your story. How does your character feel? What did they learn? Or surprise the reader with a twist!',
          2: 'Write your ending. Reflect on what happened or end with a twist.',
          3: 'Close your narrative.'
        },
        sentenceStarters: ['From that day on, ', 'I will never forget ', 'Looking back, ', 'And that is how ']
      }
    ]
  }
};

// Section colour mapping
export const SECTION_COLOURS = {
  hook: '#9b59b6',
  setting: '#3498db',
  buildup: '#f39c12',
  problem: '#e74c3c',
  resolution: '#2ecc71',
  ending: '#f1c40f'
};
