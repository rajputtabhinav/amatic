import { useState, useEffect } from "react";

import { Volume2, VolumeX, Mic, MicOff, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVoiceSettings } from "@/hooks/use-voice-settings";

// Speech Recognition types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface VoiceEnhancedChatProps {
  messageContent: string;
  onVoiceTranscription?: (transcription: string) => void;
  onVoiceError?: (error: string) => void;
  className?: string;
}

interface VoiceState {
  isListening: boolean;
  isPlaying: boolean;
  isRecording: boolean;
  currentAudio: HTMLAudioElement | null;
}

export function VoiceEnhancedChat({
  messageContent,
  onVoiceTranscription,
  onVoiceError,
  className,
}: VoiceEnhancedChatProps) {
  const { settings, updateSettings } = useVoiceSettings();
  const { voiceEnabled, autoPlayResponses, selectedVoiceId } = settings;

  const [voiceState, setVoiceState] = useState<VoiceState>({
    isListening: false,
    isPlaying: false,
    isRecording: false,
    currentAudio: null,
  });

  const [recognition, setRecognition] =
    useState<SpeechRecognitionInstance | null>(null);
  const [synthesis, setSynthesis] = useState<SpeechSynthesis | null>(null);

  // Initialize speech recognition and synthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Speech Recognition (Web Speech API)
      const win = window as WindowWithSpeechRecognition;
      if (win.webkitSpeechRecognition || win.SpeechRecognition) {
        const SpeechRecognitionClass =
          win.SpeechRecognition || win.webkitSpeechRecognition;
        if (SpeechRecognitionClass) {
          const recognitionInstance = new SpeechRecognitionClass();

          recognitionInstance.continuous = false;
          recognitionInstance.interimResults = false;
          recognitionInstance.lang = "en-US";

          recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
            const transcript = event.results[0]?.[0]?.transcript ?? "";
            onVoiceTranscription?.(transcript);
          };

          recognitionInstance.onerror = (
            event: SpeechRecognitionErrorEvent,
          ) => {
            onVoiceError?.(`Speech recognition error: ${event.error}`);
            setVoiceState((prev) => ({
              ...prev,
              isListening: false,
              isRecording: false,
            }));
          };

          recognitionInstance.onend = () => {
            setVoiceState((prev) => ({
              ...prev,
              isListening: false,
              isRecording: false,
            }));
          };

          setRecognition(recognitionInstance);
        }
      }

      // Speech Synthesis (Web Speech API)
      if ("speechSynthesis" in window) {
        setSynthesis(window.speechSynthesis);
      }
    }
  }, [onVoiceTranscription, onVoiceError]);

  // Auto-play responses when enabled
  useEffect(() => {
    if (
      autoPlayResponses &&
      messageContent &&
      voiceEnabled &&
      !voiceState.isPlaying
    ) {
      playMessage(messageContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageContent]);

  const startListening = async () => {
    if (!recognition || !voiceEnabled) {
      onVoiceError?.("Voice recognition not available");
      return;
    }

    try {
      setVoiceState((prev) => ({
        ...prev,
        isListening: true,
        isRecording: true,
      }));

      recognition.start();
    } catch (error) {
      onVoiceError?.("Failed to start voice recognition");
      setVoiceState((prev) => ({
        ...prev,
        isListening: false,
        isRecording: false,
      }));
    }
  };

  const stopListening = () => {
    if (recognition && voiceState.isListening) {
      recognition.stop();
      setVoiceState((prev) => ({
        ...prev,
        isListening: false,
        isRecording: false,
      }));
    }
  };

  const playMessage = async (text: string) => {
    if (!voiceEnabled || !text.trim()) {
      return;
    }

    // Stop any currently playing audio
    if (voiceState.currentAudio) {
      voiceState.currentAudio.pause();
      voiceState.currentAudio.currentTime = 0;
    }

    try {
      // Try ElevenLabs API first (if available)
      const response = await fetch("/api/voice/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voiceId: selectedVoiceId,
        }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onloadstart = () => {
          setVoiceState((prev) => ({
            ...prev,
            isPlaying: true,
            currentAudio: audio,
          }));
        };

        audio.onended = () => {
          setVoiceState((prev) => ({
            ...prev,
            isPlaying: false,
            currentAudio: null,
          }));
          URL.revokeObjectURL(audioUrl);
        };

        audio.onerror = () => {
          setVoiceState((prev) => ({
            ...prev,
            isPlaying: false,
            currentAudio: null,
          }));
          URL.revokeObjectURL(audioUrl);
          // Fallback to Web Speech API
          fallbackToWebSpeech(text);
        };

        await audio.play();
      } else {
        // Fallback to Web Speech API
        fallbackToWebSpeech(text);
      }
    } catch (error) {
      // Fallback to Web Speech API
      fallbackToWebSpeech(text);
    }
  };

  const fallbackToWebSpeech = (text: string) => {
    if (!synthesis) {
      return;
    }

    // Cancel any ongoing speech
    synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setVoiceState((prev) => ({ ...prev, isPlaying: true }));
    };

    utterance.onend = () => {
      setVoiceState((prev) => ({ ...prev, isPlaying: false }));
    };

    utterance.onerror = () => {
      setVoiceState((prev) => ({ ...prev, isPlaying: false }));
      onVoiceError?.("Speech synthesis error");
    };

    synthesis.speak(utterance);
  };

  const stopPlayback = () => {
    // Stop ElevenLabs audio
    if (voiceState.currentAudio) {
      voiceState.currentAudio.pause();
      voiceState.currentAudio.currentTime = 0;
      setVoiceState((prev) => ({
        ...prev,
        isPlaying: false,
        currentAudio: null,
      }));
    }

    // Stop Web Speech API
    if (synthesis) {
      synthesis.cancel();
      setVoiceState((prev) => ({ ...prev, isPlaying: false }));
    }
  };

  const toggleVoiceEnabled = () => {
    updateSettings({ voiceEnabled: !voiceEnabled });
    if (voiceEnabled) {
      stopPlayback();
      stopListening();
    }
  };

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {/* Voice Enable/Disable Toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleVoiceEnabled}
        className={`border-gray-200 ${
          voiceEnabled
            ? "text-green-700 border-green-200 bg-green-50"
            : "text-gray-500 border-gray-200"
        }`}
      >
        {voiceEnabled ? (
          <Volume2 className="h-4 w-4 mr-1" />
        ) : (
          <VolumeX className="h-4 w-4 mr-1" />
        )}
        <span className="hidden sm:inline">
          {voiceEnabled ? "Voice On" : "Voice Off"}
        </span>
      </Button>

      {voiceEnabled && (
        <>
          {/* Voice Input (Speech-to-Text) */}
          <Button
            variant="outline"
            size="sm"
            onClick={voiceState.isListening ? stopListening : startListening}
            className={`border-gray-200 ${
              voiceState.isListening
                ? "text-red-700 border-red-200 bg-red-50"
                : "text-blue-700 border-blue-200 bg-blue-50"
            }`}
            disabled={!recognition}
          >
            {voiceState.isListening ? (
              <>
                <MicOff className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Stop</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Speak</span>
              </>
            )}
          </Button>

          {/* Voice Output (Text-to-Speech) */}
          {messageContent && (
            <Button
              variant="outline"
              size="sm"
              onClick={
                voiceState.isPlaying
                  ? stopPlayback
                  : () => playMessage(messageContent)
              }
              className="border-gray-200 text-purple-700 border-purple-200 bg-purple-50"
            >
              {voiceState.isPlaying ? (
                <>
                  <Square className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Stop</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Play</span>
                </>
              )}
            </Button>
          )}

          {/* Status Indicators */}
          <div className="flex items-center space-x-1">
            {voiceState.isRecording && (
              <Badge variant="secondary" className="bg-red-100 text-red-700">
                Recording
              </Badge>
            )}
            {voiceState.isPlaying && (
              <Badge
                variant="secondary"
                className="bg-purple-100 text-purple-700"
              >
                Playing
              </Badge>
            )}
            {autoPlayResponses && (
              <Badge
                variant="secondary"
                className="bg-green-100 text-green-700"
              >
                Auto-play
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );
}
