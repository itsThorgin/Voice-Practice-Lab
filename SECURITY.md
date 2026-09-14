# Security

Voice Practice Lab runs in your browser. It has no app server, account system or online database for your practice data. Voice processing and recording playback happen on your device.

## How the app limits access

- Microphone capture starts only after you select Start microphone and the browser allows access. Stop microphone ends capture. If permission arrives after you have selected Stop, the app stops that unused microphone stream.
- Reference tones, metronome sounds, background noise and recording playback start from the app's controls. Live microphone input is never connected to the speakers.
- Scripts and styles load from this website. Fonts come from your device. The app does not load third-party app code, advertising or tracking tools.
- The page gives the browser rules that restrict scripts and other resources and block app data connections and form submissions.
- The app checks settings and numeric inputs before using them. It limits recording duration and size and keeps recordings in temporary page memory.
- Only your selected target, tuning reference and exercise range are saved. The app does not store voice recordings or practice measurements in browser storage.

## What these protections mean

These limits reduce the data the app keeps and the ways it can send data elsewhere. They do not make the app or your device immune to security problems.

Your browser controls microphone permission. The website host, browser, browser extensions and operating system are outside the app's control. The app cannot protect against a compromised device or website host. It also does not prevent another website from placing this page inside a frame.

Use the browser's site settings if you want to remove microphone permission. You can clear this app's saved settings and session data from Settings and session.
