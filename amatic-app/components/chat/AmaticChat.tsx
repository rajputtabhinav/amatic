import { useState, useRef, useEffect } from "react";

import {
  Bot,
  User,
  Send,
  Mic,
  MicOff,
  Volume2,
  PenTool,
  Brain,
  BookOpen,
  Calculator,
  Atom,
} from "lucide-react";

import { motion, AnimatePresence } from "framer-motion";

import { VoiceEnhancedChat } from "./VoiceEnhancedChat";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import { useVoiceSettings } from "@/hooks/use-voice-settings";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  hasAudio?: boolean;
  subject?: string;
  includesVisual?: boolean;
}

interface AgenticChatProps {
  onVisualExplanationRequest?: (topic: string, content: string) => void;
  canvasContext?: Record<string, unknown> | null;
  className?: string;
}

const SUBJECTS = [
  { id: "math", label: "Mathematics", icon: Calculator, color: "#ef4444" },
  { id: "science", label: "Science", icon: Atom, color: "#3b82f6" },
  { id: "english", label: "English", icon: BookOpen, color: "#8b5cf6" },
  { id: "general", label: "General", icon: Brain, color: "#6366F1" },
];

export function AgenticChat({
  onVisualExplanationRequest,
  canvasContext,
  className,
}: AgenticChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "Hello! I'm your AI assistant. I can help you with any task through conversations, visual explanations, and voice interactions. What would you like to work on today?",
      timestamp: new Date(),
      hasAudio: false,
    },
  ]);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("general");
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { settings: voiceSettings } = useVoiceSettings();
  const { voiceEnabled } = voiceSettings;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (messageContent?: string) => {
    const content = messageContent || input.trim();
    if (!content || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content,
      timestamp: new Date(),
      subject: selectedSubject,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          canvasContext: canvasContext ?? null,
          conversationHistory: messages.slice(-8).map((msg) => ({
            role: msg.type === "user" ? "user" : "assistant",
            content: msg.content,
          })),
          subject: selectedSubject,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: data.response,
        timestamp: new Date(),
        hasAudio: voiceEnabled,
        subject: selectedSubject,
        includesVisual: shouldIncludeVisual(content, data.response),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // If the response suggests visual explanation, trigger it
      if (assistantMessage.includesVisual && onVisualExplanationRequest) {
        setTimeout(() => {
          onVisualExplanationRequest(content, data.response);
        }, 1000);
      }
    } catch (error) {
      console.error("Chat API error:", error);

      const fallbackMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content:
          "I apologize, but I'm having trouble processing your request right now. Let me try to help you in a different way. Could you rephrase your question?",
        timestamp: new Date(),
        hasAudio: voiceEnabled,
        subject: selectedSubject,
      };

      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const shouldIncludeVisual = (userMessage: string, aiResponse: string) => {
    const visualKeywords = [
      "diagram",
      "draw",
      "visualize",
      "chart",
      "graph",
      "illustrate",
      "show me",
      "explain visually",
    ];
    const mathKeywords = [
      "equation",
      "formula",
      "calculate",
      "solve",
      "geometry",
      "algebra",
    ];
    const scienceKeywords = [
      "molecule",
      "atom",
      "process",
      "cycle",
      "structure",
      "system",
    ];

    const combinedText = `${userMessage} ${aiResponse}`.toLowerCase();
    return [...visualKeywords, ...mathKeywords, ...scienceKeywords].some(
      (keyword) => combinedText.includes(keyword),
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getSubjectIcon = (subjectId: string) => {
    const subject = SUBJECTS.find((s) => s.id === subjectId);
    if (!subject) {
      return Brain;
    }
    return subject.icon;
  };

  const getSubjectColor = (subjectId: string) => {
    const subject = SUBJECTS.find((s) => s.id === subjectId);
    return subject?.color || "#6366F1";
  };

  return (
    <Card className={`bg-white border-gray-200 flex flex-col ${className}`}>
      {/* Chat Header */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: "#6366F120" }}
            >
              <Bot className="h-5 w-5" style={{ color: "#6366F1" }} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">AI Assistant</h3>
              <p className="text-sm text-gray-500">
                Ask questions, get explanations, visualize concepts
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {voiceEnabled && (
              <Badge
                variant="secondary"
                className="bg-green-100 text-green-700"
              >
                <Volume2 className="h-3 w-3 mr-1" />
                Voice Enabled
              </Badge>
            )}
          </div>
        </div>

        {/* Subject Selector */}
        <div className="flex items-center space-x-2 mt-4">
          <span className="text-sm text-gray-500">Subject:</span>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((subject) => {
              const Icon = subject.icon;
              const isSelected = selectedSubject === subject.id;
              return (
                <button
                  key={subject.id}
                  onClick={() => setSelectedSubject(subject.id)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isSelected
                      ? "text-white"
                      : "text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300"
                  }`}
                  style={{
                    backgroundColor: isSelected ? subject.color : "transparent",
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span>{subject.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          <AnimatePresence>
            {messages.map((message) => {
              const SubjectIcon = message.subject
                ? getSubjectIcon(message.subject)
                : Bot;

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={`flex space-x-3 ${
                    message.type === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.type === "assistant" && (
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{
                        backgroundColor: message.subject
                          ? `${getSubjectColor(message.subject)}20`
                          : "#6366F120",
                      }}
                    >
                      <SubjectIcon
                        className="h-4 w-4"
                        style={{
                          color: message.subject
                            ? getSubjectColor(message.subject)
                            : "#6366F1",
                        }}
                      />
                    </div>
                  )}

                  <div
                    className={`max-w-[80%] p-3 rounded-2xl ${
                      message.type === "user"
                        ? "text-white rounded-br-md"
                        : "bg-gray-100 text-gray-900 rounded-bl-md"
                    }`}
                    style={{
                      backgroundColor:
                        message.type === "user" ? "#6366F1" : undefined,
                    }}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>

                    <div className="flex items-center justify-between mt-2">
                      <span
                        className={`text-xs ${
                          message.type === "user"
                            ? "text-white/70"
                            : "text-gray-500"
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>

                      <div className="flex items-center space-x-2">
                        {message.includesVisual && (
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 text-blue-700"
                          >
                            <PenTool className="h-3 w-3 mr-1" />
                            Visual
                          </Badge>
                        )}

                        {message.type === "assistant" && message.hasAudio && (
                          <VoiceEnhancedChat
                            messageContent={message.content}
                            onVoiceTranscription={(transcription: string) => {
                              setInput(transcription);
                              textareaRef.current?.focus();
                            }}
                            onVoiceError={(error: string) =>
                              console.error("Voice error:", error)
                            }
                            className="ml-auto"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {message.type === "user" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                      <User className="h-4 w-4 text-gray-600" />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex space-x-3"
            >
              <div
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "#6366F120" }}
              >
                <Bot className="h-4 w-4" style={{ color: "#6366F1" }} />
              </div>
              <div className="bg-gray-100 text-gray-900 p-3 rounded-2xl rounded-bl-md">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex space-x-3">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything about any subject..."
              className="min-h-[60px] resize-none pr-12 rounded-xl border-gray-200"
              disabled={isLoading}
            />

            <Button
              size="sm"
              variant="ghost"
              className="absolute bottom-2 right-2 h-8 w-8 p-0"
              onClick={() => setIsListening(!isListening)}
              disabled={!voiceEnabled}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" style={{ color: "#ef4444" }} />
              ) : (
                <Mic
                  className="h-4 w-4"
                  style={{ color: voiceEnabled ? "#6366F1" : "#9ca3af" }}
                />
              )}
            </Button>
          </div>

          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="h-[60px] px-6 text-white rounded-xl"
            style={{ backgroundColor: "#6366F1" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#4F46E5")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#6366F1")
            }
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>Press Enter to send, Shift+Enter for new line</span>
          <div className="flex items-center space-x-2">
            {voiceEnabled && (
              <>
                <Volume2 className="h-3 w-3" />
                <span>Voice enabled</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
