const fs = require('fs');
const ivona = require('./ivona');

ivona.listVoices()
  .on('complete', function(voices) {
      console.log(voices);
  });

//  [string] text - the text to be spoken
//  [object] config (optional) - override Ivona request via 'body' value
ivona.createVoice('<This is the text that will be spoken.', {
  body: {
    voice: {
      name: 'Salli',
      language: 'en-US',
      gender: 'Female'
    }
  }
}).pipe(fs.createWriteStream('text.mp3'));
