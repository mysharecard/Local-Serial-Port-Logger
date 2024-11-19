// Ссылки на элементы управления
const connectButton = document.getElementById('connect'); // Кнопка "Подключиться"
const stopButton = document.getElementById('stop'); // Кнопка "Остановить"
const output = document.getElementById('output'); // Поле для отображения лога
const lineCountSelect = document.getElementById('lineCount'); // Выбор количества строк для отображения
const logIntervalSelect = document.getElementById('logInterval'); // Выбор интервала записи

// Глобальные переменные
let writableStream, inputStream, port, logTimer; // Потоки записи, чтения, порт, таймер
let directoryHandle; // Ссылка на выбранную папку
let buffer = ""; // Буфер для хранения данных из порта
let logData = []; // Лог для отображения в интерфейсе
let lineLimit = 100; // Лимит строк для интерфейса
let logInterval = 20; // Интервал записи файлов (в минутах)
let logFileLineCount = 0; // Количество строк в текущем файле
const maxLinesPerFile = 500000; // Максимальное количество строк в одном файле

// Функция получения текущего времени в GMT+3 с корректным форматом для имени файла
function getGMT3Timestamp() {
  const now = new Date();
  now.setHours(now.getHours() + 3); // Добавляем 3 часа
  return now.toISOString().replace('T', '_').replace(/:/g, '-').split('.')[0]; // Корректный формат имени файла
}

// Функция выбора папки для сохранения файлов
async function selectDirectory() {
  try {
    directoryHandle = await window.showDirectoryPicker(); // Пользователь выбирает папку
    output.textContent += "Папка выбрана для сохранения файлов.\n";
  } catch (error) {
    console.error("Ошибка выбора папки:", error.message);
    output.textContent += `Ошибка выбора папки: ${error.message}\n`;
  }
}

// Функция создания нового файла внутри выбранной папки
async function openLogFile() {
  try {
    if (!directoryHandle) {
      throw new Error("Папка не выбрана. Выберите папку для сохранения файлов.");
    }
    const fileName = `com_log_${getGMT3Timestamp()}.csv`; // Имя файла
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    writableStream = await fileHandle.createWritable(); // Открываем поток записи

    const header = 'Timestamp,Message\n';
    const encoder = new TextEncoder();
    await writableStream.write(encoder.encode(header)); // Записываем заголовок
    logFileLineCount = 0; // Сбрасываем счётчик строк
  } catch (error) {
    console.error("Ошибка создания файла:", error.message);
    output.textContent += `Ошибка создания файла: ${error.message}\n`;
  }
}

// Функция записи данных в файл
async function writeToLogFile(line) {
  try {
    if (!writableStream) {
      console.error("Поток записи не открыт.");
      return;
    }
    const encoder = new TextEncoder();
    await writableStream.write(encoder.encode(`${line}\n`)); // Записываем строку
    logFileLineCount++;
  } catch (error) {
    console.error("Ошибка записи в файл:", error.message);
  }
}

// Обработка буфера и запись данных
async function processBuffer() {
  if (buffer.includes("\n")) {
    const lines = buffer.split("\n"); // Разделяем данные на строки
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        const timestamp = getGMT3Timestamp();
        const logEntry = `${timestamp},${line.replace(/[\r\n]+/g, " ")}`;
        await writeToLogFile(logEntry); // Записываем в файл
        logData.push(logEntry);

        if (logData.length > lineLimit) {
          logData.shift(); // Удаляем старые строки из интерфейса
        }
        output.textContent = logData.join("\n");
        output.scrollTop = output.scrollHeight;
      }
    }
    buffer = lines[lines.length - 1]; // Сохраняем остаток в буфере
  }
}

// Основная функция логирования
async function startLogging() {
  try {
    if (!directoryHandle) {
      await selectDirectory(); // Запрос выбора папки, если не выбрана
    }

    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 }); // Открываем порт с заданной скоростью

    await openLogFile(); // Создаём файл для записи

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    inputStream = decoder.readable.getReader();

    stopButton.disabled = false;
    connectButton.disabled = true;

    // Таймер для создания нового файла
    if (logInterval > 0) {
      logTimer = setInterval(async () => {
        if (writableStream) {
          await writableStream.close(); // Закрываем текущий файл
          await openLogFile(); // Создаём новый файл
        }
      }, logInterval * 60000); // Интервал в миллисекундах
    }

    // Основной цикл чтения данных
    while (true) {
      const { value, done } = await inputStream.read();
      if (done) break;

      if (value) {
        buffer += value;
        await processBuffer(); // Обработка данных из буфера
      }
    }

    if (buffer.trim()) {
      const sanitizedLine = buffer.trim().replace(/[\r\n]+/g, " ");
      const timestamp = getGMT3Timestamp();
      const logEntry = `${timestamp},${sanitizedLine}`;
      await writeToLogFile(logEntry); // Записываем оставшиеся данные
    }
  } catch (error) {
    console.error("Ошибка:", error.message);
    output.textContent += `Ошибка: ${error.message}\n`;
  }
}

// Функция остановки логирования
async function stopLogging() {
  try {
    if (inputStream) {
      await inputStream.cancel(); // Останавливаем поток чтения
      inputStream.releaseLock();
    }
    if (writableStream) {
      await writableStream.close(); // Закрываем поток записи
    }
    if (logTimer) {
      clearInterval(logTimer); // Останавливаем таймер
    }
  } catch (error) {
    console.error("Ошибка остановки:", error.message);
  } finally {
    stopButton.disabled = true;
    connectButton.disabled = false;
  }
}

// Обработчики изменения интерфейса
lineCountSelect.addEventListener('change', (e) => {
  lineLimit = parseInt(e.target.value, 10);
  if (logData.length > lineLimit) {
    logData = logData.slice(-lineLimit);
    output.textContent = logData.join("\n");
  }
});

logIntervalSelect.addEventListener('change', (e) => {
  logInterval = parseInt(e.target.value, 10);
});

// Подключение событий к кнопкам
connectButton.addEventListener('click', startLogging);
stopButton.addEventListener('click', stopLogging);
