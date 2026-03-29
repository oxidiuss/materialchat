import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type ProviderId = "groq" | "cerebras";
type MessageRole = "user" | "assistant";

// Функция для преобразования LaTeX синтаксиса
function preprocessLatex(content: string): string {
  // Заменяем \[ ... \] на $$ ... $$ для block math
  let processed = content.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => {
    return '\n$$\n' + formula.trim() + '\n$$\n';
  });
  
  // Заменяем \( ... \) на $ ... $ для inline math
  processed = processed.replace(/\\\((.*?)\\\)/g, (_match, formula) => {
    return '$' + formula + '$';
  });
  
  return processed;
}

// Компонент аудио плеера
function AudioPlayer({ audioUrl, fileName }: { audioUrl: string; fileName: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audio.currentTime = percentage * duration;
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3">
      <audio ref={audioRef} src={audioUrl} />
      
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)]"
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1">
        <p className="mb-1 text-xs font-medium text-[hsl(var(--on-surface))]">{fileName}</p>
        <div className="flex items-center gap-2">
          <div
            onClick={handleSeek}
            className="relative h-1 flex-1 cursor-pointer rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-highest))]"
          >
            <div
              className="absolute left-0 top-0 h-full rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))]"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] shadow-[var(--elevation-2)]"
              style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-[hsl(var(--on-surface-variant))]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  audioUrl?: string;
  audioFileName?: string;
}

interface ChatThread {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface PersistedState {
  chats: ChatThread[];
  activeChatId: string | null;
  colorTheme: string;
  darkMode: boolean;
  apiKeys: Record<ProviderId, string>;
  tavilyApiKey: string;
  models: Record<ProviderId, string[]>;
  temperature: number;
}

const COLOR_THEMES: Record<string, { name: string; colors: { h: number; s: number; l: number } }> = {
  green: { name: "Зеленый", colors: { h: 142, s: 76, l: 36 } },
  blue: { name: "Синий", colors: { h: 221, s: 83, l: 53 } },
  red: { name: "Красный", colors: { h: 0, s: 84, l: 60 } },
  purple: { name: "Фиолетовый", colors: { h: 271, s: 76, l: 53 } },
  yellow: { name: "Желтый", colors: { h: 45, s: 93, l: 47 } },
  gray: { name: "Серый", colors: { h: 220, s: 9, l: 46 } },
};

const STORAGE_KEY = "material-ai-state-v1";
const FALLBACK_THEME = "purple";

const PROVIDERS: Record<ProviderId, { label: string; modelsEndpoint: string; chatEndpoint: string }> = {
  groq: {
    label: "Groq",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    chatEndpoint: "https://api.groq.com/openai/v1/chat/completions",
  },
  cerebras: {
    label: "Cerebras",
    modelsEndpoint: "https://api.cerebras.ai/v1/models",
    chatEndpoint: "https://api.cerebras.ai/v1/chat/completions",
  },
};

const defaultApiKeys: Record<ProviderId, string> = {
  groq: "",
  cerebras: "",
};

const defaultModels: Record<ProviderId, string[]> = {
  groq: [],
  cerebras: [],
};

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(prompt: string) {
  return prompt.trim().slice(0, 40) || "Новый чат";
}

export function App() {
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [colorTheme, setColorTheme] = useState(FALLBACK_THEME);
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState(defaultApiKeys);
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [models, setModels] = useState(defaultModels);
  const [modelLoading, setModelLoading] = useState<Record<ProviderId, boolean>>({ groq: false, cerebras: false });
  const [modelError, setModelError] = useState<Record<ProviderId, string>>({ groq: "", cerebras: "" });
  const [newChatProvider, setNewChatProvider] = useState<ProviderId>("groq");
  const [newChatModel, setNewChatModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [requestError, setRequestError] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [startScreenProvider, setStartScreenProvider] = useState<ProviderId | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  };

  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeChatId) ?? null, [chats, activeChatId]);
  const selectableModels = models[newChatProvider];
  const isWhisperModel = activeChat?.model.includes("whisper") ?? false;

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setIsInitialized(true);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Partial<PersistedState>;
      if (parsed.chats) {
        setChats(parsed.chats);
      }
      if (parsed.activeChatId) {
        setActiveChatId(parsed.activeChatId);
      }
      if (parsed.colorTheme && COLOR_THEMES[parsed.colorTheme]) {
        setColorTheme(parsed.colorTheme);
      }
      if (typeof parsed.darkMode === "boolean") {
        setDarkMode(parsed.darkMode);
      }
      if (parsed.apiKeys) {
        setApiKeys({ ...defaultApiKeys, ...parsed.apiKeys });
      }
      if (parsed.tavilyApiKey) {
        setTavilyApiKey(parsed.tavilyApiKey);
      }
      if (parsed.models) {
        setModels({ ...defaultModels, ...parsed.models });
      }
      if (typeof parsed.temperature === "number") {
        setTemperature(parsed.temperature);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    
    const payload: PersistedState = {
      chats,
      activeChatId,
      colorTheme,
      darkMode,
      apiKeys,
      tavilyApiKey,
      models,
      temperature,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [chats, activeChatId, colorTheme, darkMode, apiKeys, tavilyApiKey, models, temperature, isInitialized]);

  useEffect(() => {
    const theme = COLOR_THEMES[colorTheme];
    if (!theme) return;
    
    const { h, s, l } = theme.colors;
    const root = document.documentElement;
    
    root.style.setProperty("--theme-h", `${h}`);
    root.style.setProperty("--theme-s", `${s}%`);
    root.style.setProperty("--theme-l", `${l}%`);
    root.classList.toggle("dark", darkMode);
  }, [colorTheme, darkMode]);

  useEffect(() => {
    if (!selectableModels.includes(newChatModel)) {
      setNewChatModel(selectableModels[0] ?? "");
    }
  }, [newChatProvider, selectableModels, newChatModel]);

  useEffect(() => {
    scrollToBottom();
  }, [activeChat?.messages]);

  async function fetchModels(provider: ProviderId) {
    const key = apiKeys[provider].trim();
    if (!key) {
      setModelError((prev) => ({ ...prev, [provider]: "Сначала укажите API-ключ." }));
      return;
    }

    setModelLoading((prev) => ({ ...prev, [provider]: true }));
    setModelError((prev) => ({ ...prev, [provider]: "" }));

    try {
      const response = await fetch(PROVIDERS[provider].modelsEndpoint, {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const json = (await response.json()) as { data?: Array<{ id?: string }> };
      const available = (json.data ?? [])
        .map((entry) => entry.id?.trim())
        .filter((entry): entry is string => Boolean(entry))
        .sort((a, b) => a.localeCompare(b));

      setModels((prev) => ({ ...prev, [provider]: available }));
      if (provider === newChatProvider && available.length > 0) {
        setNewChatModel(available[0]);
      }
      if (available.length === 0) {
        setModelError((prev) => ({ ...prev, [provider]: "Провайдер не вернул доступные модели." }));
      }
    } catch (error) {
      setModelError((prev) => ({
        ...prev,
        [provider]: error instanceof Error ? error.message : "Ошибка запроса моделей.",
      }));
    } finally {
      setModelLoading((prev) => ({ ...prev, [provider]: false }));
    }
  }

  function createChat() {
    if (!newChatModel) {
      setRequestError("Сначала запросите модели и выберите нужную.");
      return;
    }
    const chat: ChatThread = {
      id: createId(),
      title: `Диалог: ${PROVIDERS[newChatProvider].label}`,
      provider: newChatProvider,
      model: newChatModel,
      messages: [],
      updatedAt: Date.now(),
    };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setRequestError("");
    setShowNewChatModal(false);
    setStartScreenProvider(null);
  }

  function createChatFromStartScreen(provider: ProviderId, model: string) {
    const chat: ChatThread = {
      id: createId(),
      title: `Диалог: ${PROVIDERS[provider].label}`,
      provider,
      model,
      messages: [],
      updatedAt: Date.now(),
    };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setStartScreenProvider(null);
  }

  async function tavilySearch(query: string): Promise<string> {
    if (!tavilyApiKey.trim()) {
      return "Tavily API ключ не настроен";
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: query,
          search_depth: "basic",
          include_answer: true,
          max_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status}`);
      }

      const data = await response.json();
      
      let result = "";
      if (data.answer) {
        result += `Ответ: ${data.answer}\n\n`;
      }
      
      if (data.results && data.results.length > 0) {
        result += "Источники:\n";
        data.results.forEach((item: any, index: number) => {
          result += `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.content}\n\n`;
        });
      }
      
      return result || "Результаты не найдены";
    } catch (error) {
      return `Ошибка поиска: ${error instanceof Error ? error.message : "Неизвестная ошибка"}`;
    }
  }

  async function requestCompletion(chat: ChatThread, messages: ChatMessage[]) {
    const key = apiKeys[chat.provider].trim();
    if (!key) {
      throw new Error(`Для ${PROVIDERS[chat.provider].label} нужен API-ключ.`);
    }

    // Проверяем, нужен ли поиск (не для compound моделей)
    const needsSearch = chat.provider === "groq" && 
                       !chat.model.includes("compound") && 
                       tavilyApiKey.trim();

    const tools = needsSearch ? [{
      type: "function",
      function: {
        name: "tavily_search",
        description: "Поиск актуальной информации в интернете. Используй когда нужны свежие данные, факты, новости или информация которой нет в твоей базе знаний.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Поисковый запрос на русском или английском языке"
            }
          },
          required: ["query"]
        }
      }
    }] : undefined;

    const requestBody: any = {
      model: chat.model,
      temperature,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };

    if (tools) {
      requestBody.tools = tools;
    }

    const response = await fetch(PROVIDERS[chat.provider].chatEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    const json = await response.json();
    
    // Проверяем, вызвал ли модель tool
    if (json.choices?.[0]?.message?.tool_calls && json.choices[0].message.tool_calls.length > 0) {
      const toolCall = json.choices[0].message.tool_calls[0];
      
      if (toolCall.function.name === "tavily_search") {
        const args = JSON.parse(toolCall.function.arguments);
        const searchResults = await tavilySearch(args.query);
        
        // Отправляем результаты обратно модели
        const messagesWithTool = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          {
            role: "assistant",
            tool_calls: json.choices[0].message.tool_calls,
          },
          {
            role: "tool",
            tool_call_id: toolCall.id,
            name: "tavily_search",
            content: searchResults,
          },
        ];

        const finalResponse = await fetch(PROVIDERS[chat.provider].chatEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: chat.model,
            temperature,
            messages: messagesWithTool,
          }),
        });

        if (!finalResponse.ok) {
          throw new Error(`HTTP ${finalResponse.status}`);
        }

        const finalJson = await finalResponse.json();
        const content = finalJson.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error("Провайдер вернул пустой ответ.");
        }
        return content;
      }
    }
    
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Провайдер вернул пустой ответ.");
    }
    return content;
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activeChat || isResponding) {
      return;
    }

    // Для Whisper моделей - отправка аудио
    if (isWhisperModel) {
      if (!audioFile) {
        return;
      }
      await sendAudioMessage();
      return;
    }

    // Для обычных моделей - отправка текста
    if (!composerText.trim()) {
      return;
    }

    setRequestError("");
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: composerText.trim(),
      createdAt: Date.now(),
    };

    setComposerText("");
    setIsResponding(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const nextMessages = [...activeChat.messages, userMessage];
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              messages: nextMessages,
              title: chat.messages.length === 0 ? deriveTitle(userMessage.content) : chat.title,
              updatedAt: Date.now(),
            }
          : chat,
      ),
    );

    try {
      const assistantContent = await requestCompletion(activeChat, nextMessages);
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: assistantContent,
        createdAt: Date.now(),
      };
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                messages: [...nextMessages, assistantMessage],
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Ошибка отправки сообщения.");
    } finally {
      setIsResponding(false);
    }
  }

  async function sendAudioMessage() {
    if (!activeChat || !audioFile) return;

    setRequestError("");
    setIsResponding(true);

    // Создаем URL для аудио файла
    const audioUrl = URL.createObjectURL(audioFile);

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: "",
      audioUrl: audioUrl,
      audioFileName: audioFile.name,
      createdAt: Date.now(),
    };

    // Сразу добавляем сообщение с плеером
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              messages: [...chat.messages, userMessage],
              title: chat.messages.length === 0 ? `Транскрипция: ${audioFile.name}` : chat.title,
              updatedAt: Date.now(),
            }
          : chat,
      ),
    );

    const currentAudioFile = audioFile;
    setAudioFile(null);

    try {
      const key = apiKeys[activeChat.provider].trim();
      if (!key) {
        throw new Error(`Для ${PROVIDERS[activeChat.provider].label} нужен API-ключ.`);
      }

      const formData = new FormData();
      formData.append("file", currentAudioFile);
      formData.append("model", activeChat.model);
      formData.append("response_format", "text");

      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const transcription = await response.text();

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: transcription,
        createdAt: Date.now(),
      };

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                messages: [...chat.messages, assistantMessage],
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Ошибка транскрипции аудио.");
    } finally {
      setIsResponding(false);
    }
  }

  async function regenerateLastAnswer() {
    if (!activeChat || isResponding || activeChat.messages.length < 2) {
      return;
    }
    const lastMessage = activeChat.messages[activeChat.messages.length - 1];
    if (lastMessage.role !== "assistant") {
      setRequestError("Перегенерация доступна, когда последнее сообщение от ИИ.");
      return;
    }

    setRequestError("");
    setIsResponding(true);
    const baseMessages = activeChat.messages.slice(0, -1);

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              messages: baseMessages,
              updatedAt: Date.now(),
            }
          : chat,
      ),
    );

    try {
      const assistantContent = await requestCompletion(activeChat, baseMessages);
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: assistantContent,
        createdAt: Date.now(),
      };
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                messages: [...baseMessages, assistantMessage],
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось перегенерировать ответ.");
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                messages: activeChat.messages,
                updatedAt: Date.now(),
              }
            : chat,
        ),
      );
    } finally {
      setIsResponding(false);
    }
  }

  function deleteChat(chatId: string) {
    setChats((prev) => {
      const remaining = prev.filter((chat) => chat.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  }

  return (
    <motion.div
      className={`transition-colors duration-300 ${chats.length === 0 ? 'min-h-screen bg-[hsl(var(--app-bg))] text-[hsl(var(--app-text))]' : 'h-screen overflow-hidden bg-[hsl(var(--app-bg))] text-[hsl(var(--app-text))]'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {chats.length === 0 ? (
        // Стартовый экран без интерфейса
        <div className="min-h-screen overflow-y-auto px-5 py-12">
          <div className="mx-auto w-full max-w-2xl">
            <div className="text-center">
              <h3 className="text-5xl font-semibold tracking-tight">MaterialAI</h3>
              <p className="mt-4 text-lg text-[hsl(var(--on-surface-variant))]">
                Минималистичный чат для Groq и Cerebras с поддержкой Markdown и LaTeX.
              </p>
            </div>

            <div className="mt-16">
              <p className="mb-6 text-center text-base font-medium">Выберите провайдера</p>
              <div className="flex justify-center gap-6">
                {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
                  <button
                    key={providerId}
                    type="button"
                    onClick={() => setStartScreenProvider(providerId)}
                    className={`rounded-[var(--shape-corner-large)] px-8 py-4 text-xl font-medium transition ${
                      startScreenProvider === providerId
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--on-primary))] shadow-[var(--elevation-2)]"
                        : "bg-[hsl(var(--surface-container-high))] hover:bg-[hsl(var(--surface-container-highest))] hover:shadow-[var(--elevation-1)]"
                    }`}
                  >
                    {PROVIDERS[providerId].label}
                  </button>
                ))}
              </div>
            </div>

            {startScreenProvider && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10 rounded-[var(--shape-corner-extra-large)] bg-[hsl(var(--surface-container))] p-8 shadow-[var(--elevation-1)]"
              >
                <p className="mb-6 text-center text-base font-medium">
                  {models[startScreenProvider].length > 0 ? "Выберите модель" : "Модели не загружены"}
                </p>

                {models[startScreenProvider].length === 0 ? (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => fetchModels(startScreenProvider)}
                      disabled={modelLoading[startScreenProvider]}
                      className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] px-8 py-4 text-base font-medium text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)] disabled:opacity-40"
                    >
                      {modelLoading[startScreenProvider] ? "Загрузка..." : "Запросить модели"}
                    </button>
                    {modelError[startScreenProvider] && (
                      <p className="mt-4 text-sm text-rose-400">{modelError[startScreenProvider]}</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {models[startScreenProvider].map((modelId) => (
                        <button
                          key={modelId}
                          type="button"
                          onClick={() => createChatFromStartScreen(startScreenProvider, modelId)}
                          className="rounded-[var(--shape-corner-medium)] bg-[hsl(var(--surface-container-high))] px-5 py-4 text-left text-sm transition hover:bg-[hsl(var(--primary-container))] hover:shadow-[var(--elevation-1)]"
                        >
                          {modelId}
                        </button>
                      ))}
                    </div>
                    <div className="mt-6 text-center">
                      <button
                        type="button"
                        onClick={() => fetchModels(startScreenProvider)}
                        disabled={modelLoading[startScreenProvider]}
                        className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-highest))] px-6 py-3 text-sm font-medium transition hover:bg-[hsl(var(--surface-container-highest))] hover:shadow-[var(--elevation-1)] disabled:opacity-40"
                      >
                        {modelLoading[startScreenProvider] ? "Обновление..." : "Обновить список моделей"}
                      </button>
                      {modelError[startScreenProvider] && (
                        <p className="mt-3 text-xs text-rose-400">{modelError[startScreenProvider]}</p>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      ) : (
        // Основной интерфейс с чатами
        <div className="grid h-screen grid-cols-1 lg:grid-cols-[300px_1fr]">
        <aside className="flex h-full flex-col overflow-hidden border-b border-[hsl(var(--surface-outline-variant))] bg-[hsl(var(--surface-container-low))] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between px-5 py-5">
            <div>
              <p className="text-xs tracking-[0.12em] text-[hsl(var(--on-surface-variant))]">Material You Chat</p>
              <h1 className="text-2xl font-semibold">MaterialAI</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-highest))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-container-highest))] hover:shadow-[var(--elevation-1)]"
            >
              Настройки
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-5">
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              className="w-full rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] px-4 py-3 text-sm font-medium text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)]"
            >
              + Новый чат
            </button>

            <div>
              <p className="mb-2 text-sm font-medium">Чаты</p>
              <div className="max-h-[36vh] space-y-2 overflow-auto pr-1">
                <AnimatePresence>
                  {chats.map((chat) => (
                    <motion.button
                      key={chat.id}
                      type="button"
                      onClick={() => setActiveChatId(chat.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className={`w-full rounded-[var(--shape-corner-medium)] px-3 py-3 text-left transition ${
                        chat.id === activeChatId
                          ? "bg-[hsl(var(--secondary-container))] text-[hsl(var(--on-secondary-container))] shadow-[var(--elevation-1)]"
                          : "bg-[hsl(var(--surface-container))] hover:bg-[hsl(var(--surface-container-high))] hover:shadow-[var(--elevation-1)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="line-clamp-1 text-sm font-medium">{chat.title}</p>
                          <p className="text-xs text-[hsl(var(--on-surface-variant))]">
                            {PROVIDERS[chat.provider].label} · {chat.model}
                          </p>
                        </div>
                        <span
                          role="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          className="rounded-[var(--shape-corner-full)] px-2 py-1 text-xs text-[hsl(var(--on-surface-variant))] hover:bg-[hsl(var(--surface-container-highest))]"
                        >
                          Удалить
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex h-full flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--surface-outline-variant))] bg-[hsl(var(--surface))] px-5 py-4 lg:px-8">
            <div>
              <p className="text-sm text-[hsl(var(--on-surface-variant))]">
                {activeChat ? PROVIDERS[activeChat.provider].label : "Чат не выбран"}
              </p>
              <h2 className="text-lg font-medium">{activeChat?.model ?? "Создайте новый чат"}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!activeChat) {
                    return;
                  }
                  setChats((prev) => prev.map((chat) => (chat.id === activeChat.id ? { ...chat, messages: [] } : chat)));
                }}
                className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-high))] px-4 py-2 text-sm transition hover:bg-[hsl(var(--surface-container-highest))] hover:shadow-[var(--elevation-1)] disabled:opacity-40"
                disabled={!activeChat || isResponding}
              >
                Очистить
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-8">
            {!activeChat && (
              <div className="mx-auto mt-16 max-w-2xl text-center">
                <h3 className="text-4xl font-semibold tracking-tight">MaterialAI</h3>
                <p className="mt-3 text-[hsl(var(--on-surface-variant))]">
                  Минималистичный чат для Groq и Cerebras с поддержкой Markdown и LaTeX.
                </p>
              </div>
            )}

            {activeChat && activeChat.messages.length === 0 && (
              <div className="mx-auto mt-16 max-w-2xl text-center">
                <h3 className="text-2xl font-semibold">Диалог готов</h3>
                <p className="mt-3 text-[hsl(var(--on-surface-variant))]">Отправьте первое сообщение, чтобы начать разговор.</p>
              </div>
            )}

            <div className="mx-auto max-w-3xl space-y-3">
              <AnimatePresence>
                {activeChat?.messages.map((message, index) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                  >
                    {message.role === "user" ? (
                      <div className="ml-auto w-fit max-w-[75%]">
                        <div className="rounded-[var(--shape-corner-large)] bg-[hsl(var(--primary-container))] px-3 py-2 shadow-[var(--elevation-1)]">
                          {message.audioUrl ? (
                            <AudioPlayer audioUrl={message.audioUrl} fileName={message.audioFileName || "audio"} />
                          ) : (
                            <div className="markdown text-sm text-[hsl(var(--on-primary-container))]">
                              <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {preprocessLatex(message.content)}
                              </Markdown>
                            </div>
                          )}
                        </div>
                        {!message.audioUrl && (
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            className="ml-auto mt-1 flex items-center gap-1 rounded-[var(--shape-corner-small)] px-2 py-1 text-xs text-[hsl(var(--on-surface-variant))] hover:bg-[hsl(var(--surface-container))]"
                            title="Копировать"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="max-w-full">
                        <div className="mb-2 mt-3 border-t border-[hsl(var(--surface-outline-variant))] opacity-40" />
                        <div className="markdown text-sm">
                          <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {preprocessLatex(message.content)}
                          </Markdown>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            className="flex items-center gap-1 rounded-[var(--shape-corner-small)] px-2 py-1 text-xs text-[hsl(var(--on-surface-variant))] hover:bg-[hsl(var(--surface-container))]"
                            title="Копировать"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          </button>
                          {index === activeChat.messages.length - 1 && (
                            <button
                              type="button"
                              onClick={regenerateLastAnswer}
                              className="flex items-center gap-1 rounded-[var(--shape-corner-small)] px-2 py-1 text-xs text-[hsl(var(--on-surface-variant))] hover:bg-[hsl(var(--surface-container))] disabled:opacity-40"
                              disabled={isResponding}
                              title="Перегенерировать"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {isResponding && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-fit rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container))] px-4 py-2 text-sm text-[hsl(var(--on-surface-variant))]"
                >
                  Модель формирует ответ...
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <footer className="shrink-0 border-t border-[hsl(var(--surface-outline-variant))] bg-[hsl(var(--surface))] px-5 py-3 lg:px-8">
            <form onSubmit={sendMessage} className="mx-auto max-w-3xl">
              {isWhisperModel ? (
                // Интерфейс для аудио файлов (Whisper модели)
                <div className="rounded-[var(--shape-corner-extra-large)] bg-[hsl(var(--surface-container))] p-4 shadow-[var(--elevation-1)]">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setAudioFile(file);
                    }}
                    className="hidden"
                  />
                  
                  {!audioFile ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file && file.type.startsWith("audio/")) {
                          setAudioFile(file);
                        }
                      }}
                      className="cursor-pointer rounded-[var(--shape-corner-large)] border-2 border-dashed border-[hsl(var(--surface-outline))] bg-[hsl(var(--surface-container-low))] px-6 py-6 text-center transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--surface-container-high))]"
                    >
                      <svg className="mx-auto mb-2 h-10 w-10 text-[hsl(var(--on-surface-variant))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      <p className="text-sm text-[hsl(var(--on-surface-variant))]">
                        Нажмите для выбора аудио файла или перенесите его курсором сюда
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-[var(--shape-corner-large)] bg-[hsl(var(--surface-container-high))] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <svg className="h-8 w-8 text-[hsl(var(--primary))]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-[hsl(var(--on-surface))]">{audioFile.name}</p>
                          <p className="text-xs text-[hsl(var(--on-surface-variant))]">
                            {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAudioFile(null)}
                          className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-highest))] px-4 py-2 text-sm text-[hsl(var(--on-surface))] transition hover:bg-rose-500 hover:text-white"
                        >
                          Удалить
                        </button>
                        <button
                          type="submit"
                          disabled={isResponding}
                          className="flex h-10 w-10 items-center justify-center rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)] disabled:opacity-40"
                          title="Транскрибировать"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Обычный интерфейс для текста
                <div className="flex items-end gap-2 rounded-[var(--shape-corner-extra-large)] bg-[hsl(var(--surface-container))] px-4 py-2 shadow-[var(--elevation-1)]">
                  <textarea
                    ref={textareaRef}
                    value={composerText}
                    onChange={(event) => {
                      setComposerText(event.target.value);
                      adjustTextareaHeight();
                    }}
                    rows={1}
                    placeholder={activeChat ? "Введите сообщение..." : "Сначала создайте чат"}
                    disabled={!activeChat || isResponding}
                    className="flex-1 resize-none bg-transparent py-1 text-sm leading-5 text-[hsl(var(--on-surface))] outline-none placeholder:text-[hsl(var(--on-surface-variant))]"
                    style={{ maxHeight: "120px", overflowY: "auto" }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!activeChat || !composerText.trim() || isResponding}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)] disabled:opacity-40"
                    title="Отправить"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                    </svg>
                  </button>
                </div>
              )}
            </form>
            {requestError && <p className="mx-auto mt-2 max-w-3xl text-sm text-rose-400">{requestError}</p>}
          </footer>
        </main>
      </div>
      )}

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="custom-scrollbar max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[var(--shape-corner-extra-large)] border border-[hsl(var(--surface-outline-variant))] bg-[hsl(var(--surface-container-low))] p-5 shadow-[var(--elevation-5)]"
            >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[hsl(var(--on-surface))]">Настройки</h3>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-high))] px-3 py-1 text-sm text-[hsl(var(--on-surface))] transition hover:bg-[hsl(var(--surface-container-highest))]"
              >
                Закрыть
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
                <div key={providerId} className="rounded-[var(--shape-corner-large)] bg-[hsl(var(--surface-container))] p-4 shadow-[var(--elevation-1)]">
                  <p className="mb-2 text-sm font-medium text-[hsl(var(--on-surface))]">{PROVIDERS[providerId].label}</p>
                  <label className="mb-2 block text-xs text-[hsl(var(--on-surface-variant))]">API-ключ</label>
                  <input
                    type="password"
                    value={apiKeys[providerId]}
                    onChange={(event) =>
                      setApiKeys((prev) => ({
                        ...prev,
                        [providerId]: event.target.value,
                      }))
                    }
                    placeholder="Введите ключ"
                    className="mb-3 w-full rounded-[var(--shape-corner-medium)] bg-[hsl(var(--surface-container-highest))] px-3 py-2 text-sm text-[hsl(var(--on-surface))] outline-none placeholder:text-[hsl(var(--on-surface-variant))]"
                  />
                  <button
                    type="button"
                    onClick={() => fetchModels(providerId)}
                    disabled={modelLoading[providerId]}
                    className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)] disabled:opacity-40"
                  >
                    {modelLoading[providerId] ? "Загрузка..." : "Запросить модели"}
                  </button>
                  <p className="mt-2 text-xs text-[hsl(var(--on-surface-variant))]">Найдено моделей: {models[providerId].length}</p>
                  {modelError[providerId] && <p className="mt-1 text-xs text-rose-400">{modelError[providerId]}</p>}
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[var(--shape-corner-large)] bg-[hsl(var(--surface-container))] p-4 shadow-[var(--elevation-1)]">
              <p className="mb-2 text-sm font-medium text-[hsl(var(--on-surface))]">Tavily API (поиск в интернете)</p>
              <label className="mb-2 block text-xs text-[hsl(var(--on-surface-variant))]">API-ключ</label>
              <input
                type="password"
                value={tavilyApiKey}
                onChange={(event) => setTavilyApiKey(event.target.value)}
                placeholder="Введите Tavily API ключ"
                className="w-full rounded-[var(--shape-corner-medium)] bg-[hsl(var(--surface-container-highest))] px-3 py-2 text-sm text-[hsl(var(--on-surface))] outline-none placeholder:text-[hsl(var(--on-surface-variant))]"
              />
              <p className="mt-2 text-xs text-[hsl(var(--on-surface-variant))]">
                Используется для Groq моделей (кроме compound). Получить ключ: tavily.com
              </p>
            </div>

            <div className="mt-4 grid gap-4 rounded-[var(--shape-corner-large)] bg-[hsl(var(--surface-container))] p-4 shadow-[var(--elevation-1)] md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-3 block text-sm font-medium text-[hsl(var(--on-surface))]">Цветовая тема</label>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(COLOR_THEMES).map(([key, theme]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setColorTheme(key)}
                      className={`flex flex-col items-center gap-2 rounded-[var(--shape-corner-medium)] p-3 transition ${
                        colorTheme === key
                          ? "bg-[hsl(var(--primary-container))] shadow-[var(--elevation-2)] ring-2 ring-[hsl(var(--primary))]"
                          : "bg-[hsl(var(--surface-container-high))] hover:bg-[hsl(var(--surface-container-highest))] hover:shadow-[var(--elevation-1)]"
                      }`}
                    >
                      <div
                        className="h-10 w-10 rounded-[var(--shape-corner-full)] shadow-[var(--elevation-1)]"
                        style={{
                          backgroundColor: `hsl(${theme.colors.h}, ${theme.colors.s}%, ${theme.colors.l}%)`,
                        }}
                      />
                      <span className="text-xs text-[hsl(var(--on-surface))]">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[hsl(var(--on-surface))]">Темная тема</label>
                <button
                  type="button"
                  onClick={() => setDarkMode((prev) => !prev)}
                  className="w-full rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-high))] px-4 py-2 text-sm text-[hsl(var(--on-surface))] transition hover:bg-[hsl(var(--surface-container-highest))]"
                >
                  {darkMode ? "Включена" : "Выключена"}
                </button>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-[hsl(var(--on-surface))]">Температура: {temperature.toFixed(2)}</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </div>
            </div>

            <p className="mt-3 text-xs text-[hsl(var(--on-surface-variant))]">
              Ключи сохраняются только в localStorage вашего браузера и не отправляются на сторонний сервер.
            </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewChatModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowNewChatModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[var(--shape-corner-extra-large)] border border-[hsl(var(--surface-outline-variant))] bg-[hsl(var(--surface-container-low))] p-6 shadow-[var(--elevation-5)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-[hsl(var(--on-surface))]">Новый разговор</h3>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="rounded-[var(--shape-corner-full)] bg-[hsl(var(--surface-container-high))] px-3 py-1 text-sm text-[hsl(var(--on-surface))] transition hover:bg-[hsl(var(--surface-container-highest))]"
                >
                  Закрыть
                </button>
              </div>

              <label className="mb-2 block text-xs text-[hsl(var(--on-surface-variant))]">Провайдер</label>
              <select
                value={newChatProvider}
                onChange={(event) => setNewChatProvider(event.target.value as ProviderId)}
                className="mb-3 w-full rounded-[var(--shape-corner-medium)] bg-[hsl(var(--surface-container-highest))] px-3 py-2 text-sm text-[hsl(var(--on-surface))] outline-none ring-0"
              >
                {Object.entries(PROVIDERS).map(([providerId, provider]) => (
                  <option key={providerId} value={providerId}>
                    {provider.label}
                  </option>
                ))}
              </select>

              <label className="mb-2 block text-xs text-[hsl(var(--on-surface-variant))]">Модель</label>
              <select
                value={newChatModel}
                onChange={(event) => setNewChatModel(event.target.value)}
                className="mb-4 w-full rounded-[var(--shape-corner-medium)] bg-[hsl(var(--surface-container-highest))] px-3 py-2 text-sm text-[hsl(var(--on-surface))] outline-none"
                disabled={selectableModels.length === 0}
              >
                {selectableModels.length === 0 ? (
                  <option value="">Сначала нажмите "Запросить модели" в настройках</option>
                ) : (
                  selectableModels.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                onClick={createChat}
                className="w-full rounded-[var(--shape-corner-full)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--on-primary))] shadow-[var(--elevation-1)] transition hover:shadow-[var(--elevation-2)] disabled:opacity-50"
                disabled={!newChatModel}
              >
                Создать чат
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
