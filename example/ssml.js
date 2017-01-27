const fs = require('fs');
const ivona = require('./ivona');

const text = `
<speak>
  <p>
    <s>
      <prosody rate="slow">IVONA</prosody> means highest quality speech
      synthesis in various languages.
    </s>
    <s>
      It offers both male and female radio quality voices <break/> at a
      sampling rate of 22 kHz <break/> which makes the IVONA voices a
      perfect tool for professional use or individual needs.
    </s>
  </p>
</speak>
`;

ivona.createVoice(text, {
  body: {
    input: {
      type: 'application/ssml+xml',
    },
    voice: {
      name: 'Salli',
      language: 'en-US',
      gender: 'Female'
    }
  }
}).pipe(fs.createWriteStream('ssml.mp3'));
