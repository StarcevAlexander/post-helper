import { Service, inject, signal } from '@angular/core';
import { SPEECH_LANG } from '../constants';
import { Recognition, RecognitionConstructor } from '../models';
import { ErrorLog } from './error-log';

@Service()
export class Speech {
  readonly speakingId = signal<string | undefined>(undefined);
  readonly listening = signal(false);
  readonly synthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  readonly recognitionSupported = this.recognitionConstructor() !== undefined;

  private readonly errorLog = inject(ErrorLog);
  private recognition?: Recognition;

  startListening(onText: (text: string) => void): void {
    const Constructor = this.recognitionConstructor();
    if (!Constructor || this.listening()) {
      return;
    }
    this.stopSpeaking();

    const recognition = new Constructor();
    recognition.lang = SPEECH_LANG;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let text = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        text += event.results[index][0].transcript;
      }
      onText(text.trim());
    };
    recognition.onend = () => this.finishListening();
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        this.errorLog.record('microphone', event.error ?? 'Неизвестная ошибка');
      }
      this.finishListening();
    };

    this.recognition = recognition;
    this.listening.set(true);
    try {
      recognition.start();
    } catch (error) {
      this.errorLog.record('microphone', String(error));
      this.finishListening();
    }
  }

  stopListening(): void {
    this.recognition?.stop();
  }

  speak(id: string, text: string): void {
    if (!this.synthesisSupported) {
      return;
    }
    this.stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    const voice = speechSynthesis
      .getVoices()
      .find((candidate) => candidate.lang.toLowerCase().startsWith('ru'));
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onend = () => this.clearSpeaking(id);
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        this.errorLog.record('speech', event.error || 'Неизвестная ошибка');
      }
      this.clearSpeaking(id);
    };

    this.speakingId.set(id);
    speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
    if (!this.synthesisSupported) {
      return;
    }
    speechSynthesis.cancel();
    this.speakingId.set(undefined);
  }

  private clearSpeaking(id: string): void {
    if (this.speakingId() === id) {
      this.speakingId.set(undefined);
    }
  }

  private finishListening(): void {
    this.recognition = undefined;
    this.listening.set(false);
  }

  private recognitionConstructor(): RecognitionConstructor | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const scope = window as unknown as {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  }
}
