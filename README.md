# MaterialAI Chat

Десктопное приложение для общения с AI-моделями через Groq и Cerebras API.

## Технологии

- React 19 + TypeScript
- Vite
- Electron
- Tailwind CSS
- Framer Motion
- Поддержка LaTeX (KaTeX)

## Возможности

- Поддержка провайдеров: Groq, Cerebras
- Поиск в интернете через Tavily API
- Встроенный аудио-плеер
- Темная тема
- Несколько цветовых схем
- Сохранение истории чатов в localStorage

## Установка

```bash
npm install
```

## Запуск

```bash
# Режим разработки
npm run dev

# Electron (dev)
npm run electron

# Сборка
npm run build

# Сборка portable версии для Windows
npm run electron:build
```

## Настройка

В приложении необходимо указать API-ключи:
- Groq API key
- Cerebras API key
- Tavily API key (опционально, для поиска в интернете)
