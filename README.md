# PiezoPlay

A beginner-friendly tool for turning MP3, MIDI, and MusicXML into Arduino piezo-buzzer code.

[Open PiezoPlay](https://yuuhipro.github.io/PiezoPlay/)

## Screenshot

[PiezoPlay converting a melody into Arduino tone code](image.png)

**[Open PiezoPlay](https://yuuhipro.github.io/PiezoPlay/)**

No install needed. Import a music file, edit and preview the notes, then export Arduino code for a piezo buzzer.

## Features

- Convert MP3 audio into an editable melody
- Import MIDI and MusicXML files
- Preview and edit notes and timing
- Export Arduino C++ code using `tone()`

## Limitations

Arduino’s `tone()` function plays one note at a time, so full songs with chords, vocals, and multiple instruments may not convert cleanly. Clear, single-note melodies work best.

## Source code

[View the PiezoPlay GitHub repository](https://github.com/yuuhipro/PiezoPlay)
