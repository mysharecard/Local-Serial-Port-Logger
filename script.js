
// Ссылки на элементы управления в интерфейсе
const connectButton = document.getElementById('connect'); // Кнопка "Подключиться"
const stopButton = document.getElementById('stop'); // Кнопка "Остановить"
const output = document.getElementById('output'); // Поле для отображения лога
const lineCountSelect = document.getElementById('lineCount'); // Выпадающий список для выбора отображаемых строк
const logIntervalSelect = document.getElementById('logInterval'); // Выпадающий список для интервала записи

// Глобальные переменные
let writableStream, inputStream, port, logTimer; // Потоки записи, чтения, порт, таймер для записи
let buffer = ""; // Буфер для временного хранения данных из порта
let logData = []; // Данные для отображения в интерфейсе
let lineLimit = 100; // Лимит строк в интерфейсе
let logInterval = 20; // Интервал записи нового файла (минуты)
let logFileLineCount = 0; // Счётчик строк в текущем файле
const maxLinesPerFile = 500000; // Максимальное количество строк в одном файле

// Функция для получения текущего времени в GMT+3
function getGMT3Timestamp() {
  const now = new Date();
  now.setHours(now.getHours() + 3); // Добавляем 3 часа к текущему времени
  return now.toISOString().replace('T', '_').split('.')[0]; // Формат YYYY-MM-DD_HH-MM-SS
}

// Функция для создания нового файла и записи заголовка
async function openLogFile() {
  try {
    // Запрашиваем у пользователя место для сохранения файла
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: `com_log_${getGMT3Timestamp()}.csv`, // Имя файла
      types: [
        {
          description: 'CSV file', // Тип файла
          accept: { 'text/csv': ['.csv'] }, // Допустимое расширение
        },
      ],
    });
    writableStream = await fileHandle.createWritable(); // Открываем поток записи
    const header = 'Timestamp,Message\n'; // Заголовок для CSV файла
    const encoder = new TextEncoder(); // Кодировщик UTF-8
    await writableStream.write(encoder.encode(header)); // Записываем заголовок
    logFileLineCount = 0; // Сбрасываем счётчик строк
  } catch (error) {
    console.error("Ошибка создания файла:", error.message); // Выводим ошибку в консоль
    output.textContent += `Ошибка создания файла: ${error.message}\n`; // Показываем ошибку в интерфейсе
  }
}

// Функция для начала логирования данных
async function startLogging() {
  try {
    // Запрашиваем у пользователя выбор COM порта
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 }); // Устанавливаем скорость передачи данных

    await openLogFile(); // Создаём первый файл для записи

    const decoder = new TextDecoderStream(); // Декодер для преобразования потока в текст
    const inputDone = port.readable.pipeTo(decoder.writable); // Привязываем поток ввода
    inputStream = decoder.readable.getReader(); // Получаем поток данных для чтения

    // Активация кнопки "Остановить" и деактивация "Подключиться"
    stopButton.disabled = false;
    connectButton.disabled = true;

    // Таймер для автоматического создания нового файла каждые logInterval минут
    if (logInterval > 0) {
      logTimer = setInterval(async () => {
        if (writableStream) {
          await writableStream.close(); // Закрываем текущий файл
          await openLogFile(); // Создаём новый файл
        }
      }, logInterval * 60000); // Интервал задаётся в миллисекундах
    }

    // Основной цикл чтения данных из порта
    while (true) {
      const { value, done } = await inputStream.read(); // Читаем данные из порта
      if (done) break; // Если поток завершён, прерываем цикл

      if (value) {
        buffer += value; // Добавляем данные в буфер

        if (buffer.includes("\n")) {
          const lines = buffer.split("\n"); // Разделяем данные на строки
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim(); // Убираем лишние пробелы
            if (line) {
              const sanitizedLine = line.replace(/[\n]+/g, " "); // Убираем внутренние переводы строк
              const timestamp = getGMT3Timestamp(); // Получаем временную метку
              const logEntry = `${timestamp},${sanitizedLine}`;

              try {
                if (writableStream.locked) { // Проверяем, доступен ли поток записи
                  await writableStream.write(`${logEntry}\n`); // Записываем данные в файл
                  logFileLineCount++;
                }
              } catch (error) {
                console.error("Ошибка записи в файл:", error.message);
                output.textContent += `Ошибка записи: ${error.message}\n`;
              }

              // Обновляем интерфейс
              logData.push(logEntry);
              if (logData.length > lineLimit) logData.shift(); // Удаляем старые строки, если их больше лимита
              output.textContent = logData.join("\n"); // Обновляем отображение данных
              output.scrollTop = output.scrollHeight; // Прокручиваем вниз

              // Создаём новый файл, если достигнут лимит строк
              if (logInterval === 0 && logFileLineCount >= maxLinesPerFile) {
                if (writableStream.locked) {
                  await writableStream.close();
                }
                await openLogFile();
              }
            }
          }
          buffer = lines[lines.length - 1]; // Сохраняем незавершённую строку
        }
      }
    }

    // Обрабатываем остаток данных в буфере
    if (buffer.trim() && writableStream.locked) {
      const sanitizedLine = buffer.trim().replace(/[\n]+/g, " ");
      const timestamp = getGMT3Timestamp();
      const logEntry = `${timestamp},${sanitizedLine}`;
      await writableStream.write(`${logEntry}\n`);
      logData.push(logEntry);
      output.textContent = logData.join("\n");
    }
  } catch (error) {
    console.error("Ошибка:", error);
    output.textContent += `Ошибка: ${error.message}\n`;
  }
}

// Функция для остановки логирования данных
async function stopLogging() {
  try {
    if (inputStream) {
      await inputStream.cancel(); // Останавливаем поток чтения
      inputStream.releaseLock(); // Освобождаем ресурс
    }
    if (writableStream && writableStream.locked) {
      await writableStream.close(); // Закрываем текущий файл
    }
    if (logTimer) {
      clearInterval(logTimer); // Останавливаем таймер
    }
  } catch (error) {
    console.error("Ошибка:", error);
  } finally {
    stopButton.disabled = true; // Деактивируем кнопку "Остановить"
    connectButton.disabled = false; // Активируем кнопку "Подключиться"
  }
}

// Обновление лимита строк в интерфейсе
lineCountSelect.addEventListener('change', (e) => {
  lineLimit = parseInt(e.target.value, 10); // Устанавливаем новый лимит
  if (logData.length > lineLimit) {
    logData = logData.slice(-lineLimit); // Оставляем только последние строки
    output.textContent = logData.join("\n"); // Обновляем отображение
  }
});

// Обновление интервала записи файлов
logIntervalSelect.addEventListener('change', (e) => {
  logInterval = parseInt(e.target.value, 10); // Устанавливаем новый интервал
});

// Подключение событий к кнопкам
connectButton.addEventListener('click', startLogging); // Начало логирования
stopButton.addEventListener('click', stopLogging); // Остановка логирования
