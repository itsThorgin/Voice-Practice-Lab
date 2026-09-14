# Voice Practice Lab

Voice Practice Lab is a browser app for singing and voice practice. Use it to check your pitch, practise notes and scales, compare two recordings, follow a speaking pace, or play background noise while you train.

The app runs on your device. It does not upload your voice or require an account.

## Contents

- [Privacy and security](#privacy-and-security)
- [Guide to the panels](#guide-to-the-panels)
- [Sound, volume, and microphone pickup](#sound-volume-and-microphone-pickup)
- [Common problems](#common-problems)

Each practice panel has a **?** button for help and an arrow to collapse or expand it. Use Tab to move between controls. A focused **Play reference** button also works with Space or Enter: hold the key to listen and release it to stop.

## Privacy and security

### What stays on your device

Microphone audio, pitch readings, practice results, and recordings are processed in your browser. The app does not upload them.

| Data | Where it stays | What happens later |
| --- | --- | --- |
| Recordings A and B | Temporary page memory | Reset, reload, or leaving the page clears them |
| Pitch history and practice results | Temporary page memory | Reset, reload, or leaving the page clears them |
| Manual target choices, tuning, and exercise range | This browser's local storage | Kept until you clear them or the browser removes them |
| Metronome, speech pacing, and noise settings | Current page session | Reloading starts with defaults |

Every new page session starts with **No target**, even when a previous target choice was saved. Select a target source to use one.

There are no accounts, analytics, advertising, trackers, remote fonts, or third party runtime libraries. The app has no backend or online database for practice data.

### What the website host can see

Your browser requests the website's files from its host, including its audio processor code. These requests do not contain your practice audio.

The host can receive your IP address and normal browser request details, and it may keep access logs. Local voice processing does not make website visits anonymous.

### How access is limited

Microphone capture starts only after you select **Start microphone** and the browser grants permission. **Stop microphone** ends capture. If permission arrives after you have pressed Stop, the app stops the unused stream.

The page uses a Content Security Policy, which gives the browser rules about allowed resources. Scripts and styles come from the same website. App data connections and form submissions are blocked. Numeric settings are checked before use, and recordings have duration and size limits.

These protections reduce exposure. They are not a promise that the app, website host, browser, extensions, or operating system can never have a security problem. The app does not prevent another website from embedding it in a frame. Deleting app data also cannot guarantee immediate erasure of every copy in browser or operating system memory.

Use your browser's site settings to remove microphone permission. The app's data controls do not remove that permission or clear unrelated browser data.

Read the full [Privacy](PRIVACY.md) and [Security](SECURITY.md) notes for more detail.

## Guide to the panels

### 1. Current pitch: live tuner

**What it does:** estimates the pitch of a clear, repeating sound from your microphone. Use it to see whether you are above or below a note and whether your pitch stays steady.

**How to use it:** start the microphone, then sing or hum a steady sound. Leave the target set to **No target** to follow the nearest musical note. Select a target to compare your voice with that specific pitch.

| Reading | Meaning |
| --- | --- |
| Detected note | The nearest musical note to your detected voice pitch |
| Frequency, in Hz | Repetitions per second; a higher number means a higher pitch |
| Cents | Distance from the target, or the nearest note when no target is selected; 100 cents is one semitone |
| Confidence | How clearly the detector finds a repeating pattern; this is confidence in the estimate, not a voice quality score |
| Stability | Recent pitch variation in cents; a smaller value means a steadier pitch |
| Voice state | Whether a reliable pitch is currently available |
| Held duration | Time spent within ±20 cents of the selected target |

Negative cents mean your pitch is low. Positive cents mean it is high. A stable pitch can still be far from the target.

Held duration needs a selected target. It resets when you leave the allowed range, detection becomes unreliable, the target changes, or reference playback starts. Guided exercises have their own completion rules.

Speech, breath sounds, quiet input, and background noise may contain no clear pitch. **No pitch detected** is a measurement limit, not a review of your career prospects.

### 2. Target pitch: practice reference

**What it does:** sets the pitch you want to practise and provides a generated reference tone.

**How to use it:** choose a **Target source**:

- **No target:** the tuner compares your voice with its nearest note.
- **Note:** select the note name and octave. C4 is middle C.
- **Exact Hz:** enter a specific frequency.

Use **Tuning reference** to change the frequency assigned to A4. You can select a provided value or enter a custom one. Note based target frequencies follow this tuning. An exact Hz target keeps the frequency you entered.

Hold **Play reference** with your finger, mouse, Space, or Enter. Release to stop. All reference buttons show the same green playback state, including the button under your pointer. After release, the normal button style returns.

The exercise range in Settings does not restrict the free tuner or manual target selection. Very low and high frequencies can be difficult for microphones, speakers, and the detector.

### 3. Guided practice

**What it does:** gives you a pitch goal, tracks an attempt, and shows measurements and a practice score.

**How to use it:** start the microphone, set a comfortable exercise range in **Settings and session**, then choose a **Practice mode**. Listen to the reference before starting or singing. Reference playback breaks the current hold; the attempt timer continues.

#### Match selected target

Choose a target inside your exercise range and select **Start attempt**. Stay within ±20 cents for one steady second. You have 15 seconds to complete the attempt.

A steady match also needs enough reliable readings and a recent stability spread of no more than 10 cents. **Retry** starts a fresh attempt with the same target.

#### Random notes

Select **Next note** to generate a target inside your exercise range, then start the attempt. The match goal is the same as above.

**Retry** keeps the current note. **Next note** chooses another target. Generated targets stay separate from your manual target choice. The random session shows results and an average for retained attempts with enough reliable data.

#### Sustained note

Choose a target, **Required hold**, and **Allowed error**, then start the attempt. Hold durations are 2, 3, 5, or 10 seconds. Allowed error is ±20, ±10, or ±5 cents. You have 30 seconds for the attempt.

Stay inside the selected range for the required duration. Going outside it breaks the hold. Brief detection gaps can be bridged; longer gaps reset the current hold. Your best hold remains visible. Stability is measured separately and does not decide whether this mode completes.

#### Interval practice

Choose a **Root note**, an **Interval**, and a **Direction**. Both notes must fit inside your exercise range.

Before starting, **Reference note** lets you preview the root or target. Start the attempt, sing the root first, then sing the target when the app advances. Each note has a one-second steady match goal within ±20 cents and a 15-second limit. The two notes receive separate results. **Retry** restarts both stages.

#### Scale practice

Choose the **Lower tonic**, **Scale type**, and **Scale direction**. The lower tonic is the scale's base note; a descending scale starts one octave above it. Available scales are Major, Natural minor, and Chromatic. Directions are up, down, or up then down. The complete sequence must fit inside your exercise range.

Start the attempt and sing the highlighted note. Each note uses the same one-second steady match goal and 15-second limit. **Play reference** follows the current note.

**Next note (skip)** moves past a note. On the last note, this becomes **Finish without matching**. **Back one note** clears that note's result and later results for another try. **Retry** restarts the whole scale. The results show individual notes and a whole scale summary.

#### Understanding the results

The practice score combines four parts:

| Part | Maximum points | What it describes |
| --- | --- | --- |
| Accuracy | 50 | Closeness to the target across the attempt |
| Stability | 20 | Consistency of pitch across the attempt |
| Hold | 20 | Best qualifying continuous hold relative to the goal |
| Completion | 10 | Whether the note goal was completed |

Completing a note does not guarantee 100 points. Separate short holds do not add together. Too few reliable readings produce no score, rather than a zero.

Open **Measurements** for pitch errors and timing. Open the panel's **?** help for formulas, missing reading rules, and session averages. Compare attempts made with similar goals and equipment. Vibrato can reduce stability points. The score measures pitch practice, not acting quality, expression, or the value of your voice.

### 4. Target tone shape: visual reference

**What it does:** compares two mathematical sine waves: the selected target and a model made from your detected pitch.

**How to use it:** choose a target to see the solid target curve. Start the microphone and sing to add the dashed detected pitch model. Both curves use equal amplitude and the same starting phase, so you can compare their frequency.

This is a simplified pitch model. It does not show your voice's actual waveform, tone colour, or loudness. Small pitch differences can look almost identical in this short view; use the cents reading for precise comparison. The **Near** and **steady** feedback is separate from guided exercise completion.

### 5. Pitch history: recent movement

**What it does:** shows roughly the last eight seconds of detected pitch and a live note scale. Use it to spot drift, jumps, and repeated pitch patterns.

**How to use it:** start the microphone and sing. The graph shows recent movement. On the right hand scale, **●** marks your pitch and **◁** marks the target. The reference line follows the selected target or nearest note. Red above the reference means sharp; blue below means flat.

A selected target helps you compare repeated attempts with the same note. **Reset history** clears this view without clearing your recordings. The panel's steady hold feedback does not complete an exercise by itself.

### 6. Waveform: live input

**What it does:** shows the microphone signal changing over a short period, plus a signal level meter.

**How to use it:** start the microphone, speak or sing, and watch how the signal changes. Use the meter to check that input is arriving and to notice large changes in recording level.

The waveform is useful for seeing the signal's shape. It is not the pitch detector, and the level meter is not a calibrated loudness measurement.

### 7. Frequency spectrum: harmonic view

**What it does:** shows how sound energy is distributed from 50 Hz to 5 kHz. Lower frequencies appear on the left and higher frequencies on the right.

**How to use it:** start the microphone and hold a sound. Try different vowels or pitches and observe how the peaks change.

A voice normally produces several harmonic peaks. The tallest peak is not always the fundamental pitch, which is the base repetition rate you perceive as the note. Use **Current pitch** for the pitch estimate. The spectrum is a visual reference, not a voice quality score.

### 8. Practice recording: listen back

**What it does:** keeps two temporary takes, A and B, for local listening and comparison of timing, recorded level, and pitch.

**How to use it:**

1. Start the microphone and choose a **Recording limit** of 15, 30, or 60 seconds.
2. Select **Record first take**, perform your line or exercise, then select **Stop recording**.
3. Select **Keep as reference A**.
4. Select **Record comparison B** and record another attempt.
5. Use **Play A**, **Play B**, or **Play A + B** to compare them. Adjust **A level** and **B level** as needed.

Use **Playback position** to move along the timeline. Switching A/B keeps the timeline position. **Pause** stops at the current position; **Return to start** rewinds.

Use **B offset (seconds)** to align different recording starts. A positive value places B later than A; a negative value places it earlier. The offset affects both the graph and playback.

A uses coral and a solid pitch line. B uses green and a dashed pitch line. The envelopes show recorded signal level. Pitch contours cover 50-2000 Hz, with gaps where pitch is uncertain or absent. These views help compare timing and pitch; they do not rate your delivery or tone colour.

Recording again replaces B. You can replace A with B or delete either take. Each take is limited to 60 seconds and 16 MiB. **Stop microphone** keeps completed takes, but session reset, reload, or leaving the page removes them. There is no built-in recording export control. Treat these as practice takes, not your only copy of a performance.

### 9. Metronome: music and speech pacing

**What it does:** provides a steady sound, visual cue, or both. Sound and visuals can be controlled independently.

#### Music mode

Select **Music**, set a tempo from **20 to 300 BPM**, and choose a beat pattern. BPM means beats per minute.

Common patterns and custom groups are available. For example, `3+2` has five small beats, grouped as three and two. With **Strong beats** enabled, the start of each group is accented. Custom groups can contain up to 16 beats in total.

For compound patterns such as 6/8, BPM counts each small beat. **Subdivisions** add quieter pulses between the main beats. To hear equal pulses, turn off **Strong beats** and set subdivisions to **None**.

Choose **Soft beep**, **Click**, **Woodblock**, **Rimshot**, or **Hi-hat**, adjust volume, and select **Start metronome**. The sounds are synthesized locally without third-party recordings.

#### Speech pacing mode

Select **Speech pacing**, choose a delivery style, and select **Relaxed**, **Typical**, or **Brisk**.

| Delivery style | Typical starting pace |
| --- | --- |
| Audiobook | 155 WPM |
| Radio / Podcast | 160 WPM |
| TV / Radio ad | 175 WPM |
| Fast disclaimer / Retail ad | 220 WPM |
| Documentary / Corporate | 140 WPM |

WPM means words per minute. One pulse represents one word at the target average pace. A 155 WPM setting produces 155 pulses per minute.

Use the rhythm as a general reference for speaking faster or slower. Keep natural pauses and expression; you do not need to place each word on a pulse. No script or average syllable count is needed.

These presets are adjustable starting points. The app does not listen to your words, count syllables, measure your actual WPM, or enforce a required delivery speed. The client may still have opinions. The metronome does not.

#### Visual cues

Turn on **Visual cues** for the beat display and edge glow. Enable **Pulse other practice panels** to apply the glow to all collapsible panels.

**Border intensity** offers Soft, Medium, and Strong. Turn off **Sound on** for silent pacing. **Reduced motion** removes the glow while retaining the changing beat label. The app also follows your device's reduced motion preference.

Select **Stop** to end the metronome. Hiding or leaving the page stops it; returning does not restart it automatically.

### 10. Noise generator: background for practice

**What it does:** generates continuous white, pink, or brown noise on your device. Fresh random samples are produced as it plays. There is no repeating recording or loop join.

| Noise tab | Sound and technical meaning | Starting volume |
| --- | --- | --- |
| White | Bright hiss, with roughly equal energy in equal width frequency bands | 0.50% |
| Pink | Less sharp, with roughly equal energy per octave | 0.50% |
| Brown | Deeper sound, with more energy at low frequencies | 2.00% |

**How to use it:** adjust volume, select **Start noise**. Try pink if white sounds too sharp, or brown if you prefer a deeper background. Small phone speakers may reproduce little of brown noise's low rumble.

One noise plays at a time. Switching noises while it plays changes the sound. Each noise keeps its own volume for the current session. **Mute** silences the output without ending the running session. **Stop** ends it.

Noise is allowed during exercises and recording. It can make other background sounds less noticeable, but it does not remove noise from your recording. Your microphone may pick it up. Use headphones or lower the volume if it affects your readings or takes.

### Voice Training with Background Noise

| Overview | It alters how the brain and vocal system function in loud environments. It trains the speaker to overcome the natural reflex to yell, shifting the physical effort from the throat to the respiratory system. |
| --- | --- 
| Vocal Mechanism and Control | Background noise activates the Lombard effect, an automatic reflex where speakers raise their pitch and volume to compete with ambient sound. Training with deliberate background noise teaches individuals to control this reflex. Speakers learn to increase their sound pressure level using subglottic pressure from the lungs rather than squeezing the intrinsic laryngeal muscles. This protects the vocal cords from tissue trauma and prevents muscle tension dysphonia. |
| Articulation and Speech Intelligibility | Ambient sound easily masks high frequency, low energy speech sounds, particularly unvoiced consonants like /p/, /t/, /k/, and /s/. Training sessions in noisy environments force the speaker to increase their articulatory precision. The brain learns to coordinate the tongue, lips, and jaw with greater dynamic range, resulting in hyper articulation. This ensures that consonants remain distinct and words remain intelligible even when the acoustic signal is degraded by competing noise. |
| Acoustic Resonance and Projection | To be heard over noise without straining, the speaker must optimize vocal tract resonance. Training teaches the speaker to alter the shape of the pharynx and epilarynx to amplify specific frequencies. Specifically, it boosts energy in the 2,000 to 4,000 Hz range, often called the speaker's formant or vocal ring. This frequency band matches the human ear's highest sensitivity, allowing the voice to cut through low frequency environmental noise with minimal physical effort. |
| Auditory Processing and Cognitive Focus | Speaking in a loud environment requires significant cognitive load as the brain tries to monitor its own output while filtering external noise. Training strengthens the auditory feedback loop and top down cognitive processing. The central auditory system learns to suppress irrelevant acoustic distractions, allowing the speaker to maintain their speech rate, intonation, and focus without cognitive fatigue. |

The main **?** button explains all three noise types. Continuous generation requires a browser with AudioWorklet support, which lets the browser run the audio generator separately from page controls. Hiding or leaving the page stops the noise; press Start again after returning.

### 11. Settings and session

**What it does:** defines your exercise note range and provides separate controls for session data and saved settings.

**Exercise vocal range:** choose your comfortable lowest and highest notes. Both limits are included. This range applies to guided exercises, not the free tuner or manual target selection. C4 is middle C.

The Lower, Middle, and Higher presets provide starting ranges. They are not voice type classifications. A preset replaces both limits; edit either note to customize it.

| Control | What it does |
| --- | --- |
| Reset current session | Stops capture and playback; clears recordings, pitch history, and practice results; keeps current settings |
| Clear saved app settings | Removes saved preferences while keeping the current session; changing a setting later can save it again |
| Delete all app data | After confirmation, stops audio, clears the session and saved settings, and restores defaults |

These controls affect this app's data. They do not clear other websites, browser history, or microphone permission. If browser storage is unavailable, the app shows a message.

## Sound, volume, and microphone pickup

Metronome and noise volume fields accept **0.01-100%** in steps of **0.01 percentage points**. Decimal points and commas both work, for example `0.50` or `0,50`. Enter **0** for silence, or use the relevant sound or mute control.

These percentages control the app's output gain. Device volume, headphones, speakers, and sound type affect what you hear. Equal percentages do not guarantee equal perceived loudness.

Reference tones, metronome beats, and background noise can enter the microphone through your speakers. This can affect pitch readings and recordings. Headphones help separate playback from microphone input. Silent metronome cues are available when you want no added sound.

When the page goes into the background, microphone input and analysis pause. Previously started input can resume when you return, or the app may ask you to select **Resume microphone**. Recording, reference playback, metronome, and noise do not restart automatically.

## Common problems

| Problem | What to check |
| --- | --- |
| The microphone will not start | Check browser and operating system permission, and confirm the intended microphone is available |
| No pitch or a jumping note | Try a clear sustained vowel or hum, reduce background noise, and check the input level; some speech sounds have no stable pitch |
| A very low or high note seems wrong | Microphone filtering, speakers, sample rate, and detector limits can affect extreme frequencies |
| Play reference is disabled | Choose a target source and a valid target first |
| An exercise will not start | Start the microphone and check that the target, interval, or entire scale fits inside your exercise range |
| Reference playback stops | Keep holding the button or Space/Enter; release, lost focus, and page hiding stop playback |
| No metronome or noise sound | Check Start, app volume, Sound on or Mute, device volume, and output device; noise generator also needs AudioWorklet support |
| Recording is unavailable | The browser may not support the required recording features; the tuner can still work |
| A recording disappeared | Takes are temporary; reset, reload, navigation away, deletion, or replacement can remove them |
| The glow is missing | Enable Visual cues, check Reduced motion and your device preference, and enable Pulse other practice panels if needed |

Browser audio support and background restrictions vary.
