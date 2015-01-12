var fs = require('fs'),
    Ivona = require('../src/main');

var ivona = new Ivona({
    accessKey: 'IVONA_ACCESS_KEY',
    secretKey: 'IVONA_SECRET_KEY'
});

ivona.listVoices().on('complete', function(voices) {
    console.log(voices);
});

// output to the file example/test.mp3
ivona.createVoice('This is the text that will be spoken.')
    .pipe(fs.createWriteStream('example/test.mp3'));