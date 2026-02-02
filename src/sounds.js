/**
 * Sound Manager - Web Audio API based sounds for UNO
 * No external files needed - generates sounds programmatically
 */

class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.volume = 0.5;
        this.init();
    }

    init() {
        // Create audio context on first user interaction
        document.addEventListener('click', () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
        }, { once: true });
    }

    ensureContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    // Play a tone with given frequency and duration
    playTone(frequency, duration, type = 'sine', gainValue = this.volume) {
        if (!this.enabled) return;
        this.ensureContext();

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

        gainNode.gain.setValueAtTime(gainValue, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }

    // Play multiple tones in sequence (for melodies)
    playMelody(notes) {
        if (!this.enabled) return;
        let delay = 0;
        notes.forEach(note => {
            setTimeout(() => {
                this.playTone(note.freq, note.duration, note.type || 'sine', note.gain || this.volume);
            }, delay * 1000);
            delay += note.duration * 0.8;
        });
    }

    // Card flip/play sound
    cardPlay() {
        this.playTone(800, 0.08, 'square', 0.2);
        setTimeout(() => this.playTone(1000, 0.05, 'square', 0.15), 40);
    }

    // Draw card sound
    cardDraw() {
        this.playTone(400, 0.1, 'triangle', 0.3);
        setTimeout(() => this.playTone(500, 0.08, 'triangle', 0.2), 60);
    }

    // Your turn notification
    yourTurn() {
        this.playMelody([
            { freq: 523, duration: 0.1 }, // C5
            { freq: 659, duration: 0.1 }, // E5
            { freq: 784, duration: 0.15 } // G5
        ]);
    }

    // UNO call sound
    unoCall() {
        this.playMelody([
            { freq: 440, duration: 0.15, type: 'square' },
            { freq: 554, duration: 0.15, type: 'square' },
            { freq: 659, duration: 0.2, type: 'square' },
            { freq: 880, duration: 0.3, type: 'square' }
        ]);
    }

    // Skip card sound
    skip() {
        this.playTone(600, 0.1, 'sawtooth', 0.2);
        setTimeout(() => this.playTone(300, 0.15, 'sawtooth', 0.2), 100);
    }

    // Reverse card sound
    reverse() {
        this.playMelody([
            { freq: 600, duration: 0.1, type: 'triangle' },
            { freq: 500, duration: 0.1, type: 'triangle' },
            { freq: 400, duration: 0.1, type: 'triangle' },
            { freq: 500, duration: 0.1, type: 'triangle' },
            { freq: 600, duration: 0.1, type: 'triangle' }
        ]);
    }

    // Draw Two / Draw Four sound
    drawPenalty() {
        this.playTone(200, 0.2, 'sawtooth', 0.3);
        setTimeout(() => this.playTone(150, 0.3, 'sawtooth', 0.25), 150);
    }

    // Wild card color select
    wildCard() {
        this.playMelody([
            { freq: 300, duration: 0.1, type: 'sine' },
            { freq: 400, duration: 0.1, type: 'sine' },
            { freq: 500, duration: 0.1, type: 'sine' },
            { freq: 600, duration: 0.15, type: 'sine' }
        ]);
    }

    // Color selected sound
    colorSelect() {
        this.playTone(700, 0.1, 'sine', 0.3);
    }

    // Win/victory sound
    victory() {
        this.playMelody([
            { freq: 523, duration: 0.15 }, // C5
            { freq: 523, duration: 0.15 }, // C5
            { freq: 523, duration: 0.15 }, // C5
            { freq: 523, duration: 0.4 },  // C5
            { freq: 415, duration: 0.4 },  // Ab4
            { freq: 466, duration: 0.4 },  // Bb4
            { freq: 523, duration: 0.15 }, // C5
            { freq: 466, duration: 0.1 },  // Bb4
            { freq: 523, duration: 0.6 }   // C5
        ]);
    }

    // Lose sound
    lose() {
        this.playMelody([
            { freq: 400, duration: 0.3, type: 'triangle' },
            { freq: 350, duration: 0.3, type: 'triangle' },
            { freq: 300, duration: 0.5, type: 'triangle' }
        ]);
    }

    // Error/invalid action sound
    error() {
        this.playTone(200, 0.15, 'square', 0.2);
        setTimeout(() => this.playTone(180, 0.15, 'square', 0.2), 150);
    }

    // Button click
    click() {
        this.playTone(600, 0.05, 'sine', 0.15);
    }

    // Join/connect sound
    playerJoin() {
        this.playMelody([
            { freq: 400, duration: 0.1 },
            { freq: 600, duration: 0.1 }
        ]);
    }

    // Player leave/disconnect
    playerLeave() {
        this.playMelody([
            { freq: 500, duration: 0.1 },
            { freq: 350, duration: 0.15 }
        ]);
    }

    // Game start
    gameStart() {
        this.playMelody([
            { freq: 392, duration: 0.1 }, // G4
            { freq: 440, duration: 0.1 }, // A4
            { freq: 494, duration: 0.1 }, // B4
            { freq: 523, duration: 0.2 }, // C5
            { freq: 659, duration: 0.3 }  // E5
        ]);
    }

    // Caught not saying UNO
    caught() {
        this.playMelody([
            { freq: 800, duration: 0.1, type: 'square' },
            { freq: 400, duration: 0.1, type: 'square' },
            { freq: 800, duration: 0.1, type: 'square' },
            { freq: 400, duration: 0.2, type: 'square' }
        ]);
    }

    // Toggle sound on/off
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    // Set volume (0-1)
    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));
    }
}

// Export singleton instance
export const sounds = new SoundManager();
