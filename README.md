# README.md

## find-cycles.js

Скрипт для поиска циклических зависимостей между доменными сущностями в формате `.ro`. Он рекурсивно обходит указанный каталог, находит все файлы `.ro`, извлекает домены (`type: domain`) и собирает ссылки на другие домены по FQID. Затем строит граф зависимостей и ищет в нём циклы. Результатом является отчёт со списком найденных циклов, включая подробную информацию о ссылках, замыкающих цикл.

---

## Что делает приложение

- Рекурсивно сканирует указанный каталог и находит файлы `.ro`.
- Парсит YAML-содержимое, включая «мягкий» режим для нестандартных тегов и анкоров.
- Отбирает только файлы с `type: domain`.
- Для каждого домена собирает FQID-ссылки на другие домены.
- Строит граф зависимостей и ищет в нём циклы с помощью поиска в глубину (DFS).
- Удаляет дубликаты циклов и отбрасывает self-ссылки.
- Выводит найденные циклы в консоль в читаемом виде или в формате JSON.
- Может сохранить отчёт в текстовый или JSON-файл.

---

## Требования

- Node.js **12+** (используется `fs`, `path`, `js-yaml`).
- Установленный npm-пакет:
    - `js-yaml`

Установка:

```bash
npm init -y
npm install js-yaml
---

## Использование

```bash
node find-cycles.js <каталог> [опции]
```

Пример:

```bash
node find-cycles.js ./domains
```

---

## Опции командной строки

| Опция | Описание |
|---|---|
| `--json` | Вывести отчёт в формате JSON вместо текстового. |
| `--brief` | Краткий вывод: только список доменов в каждом цикле, без деталей FQID. |
| `--output <file>` | Сохранить отчёт в указанный файл. Если не указан `--json`, сохраняется текстовый отчёт. |
| `--help` | Показать справку и выйти. |

---

## Формат файлов `.ro`

Скрипт обрабатывает YAML-файлы с расширением `.ro`. Ожидается, что внутри есть поля `id` и `type`.
Если `type` не равен `domain`, файл пропускается.

---

## Как определяются зависимости

Зависимости ищутся во всех строковых значениях YAML-структуры. Строка считается ссылкой на другой домен, если она соответствует FQID-шаблону:

```
<domainId>/<entityId>
```

где `domainId` — это идентификатор домена (может содержать точки и дефисы), а `entityId` — идентификатор сущности внутри домена.

---

## Вывод в консоль

### Режим по умолчанию (подробный)

Выводится статистика анализа и подробная информация о каждом цикле:

```text
🔴 Found 2 cyclic dependencies:

================================================================================
Cycle #1
================================================================================

📦 Domains in cycle:
   1. domain-a ↓
      File: /path/to/domains/domain-a.ro
   2. domain-b ↓
      File: /path/to/domains/domain-b.ro
   3. domain-c ↩
      File: /path/to/domains/domain-c.ro

🔗 Closing reference:
   FQID: domain-c/entity-1
   Path: some.path.to.field
   File: /path/to/domains/domain-c.ro
   From: domain-c
   To: domain-a

📎 All FQID references in cycle:

   domain-a → domain-b
   FQID: domain-a/entity-2
   Path: ...
   File: ...

   domain-b → domain-c
   FQID: domain-b/entity-3
   Path: ...
   File: ...

   domain-c → domain-a
   FQID: domain-c/entity-1
   Path: ...
   File: ...
```

### Режим `--brief`

Выводится только список доменов в каждом цикле:

```text
🔴 Found 2 cyclic dependencies:

1. domain-a ⇄ domain-b ⇄ domain-c
2. domain-x ⇄ domain-y
```

---

## JSON-отчёт

При использовании флага `--json` формируется JSON-объект следующей структуры:

```json
{
  "generatedAt": "2025-01-01T12:00:00.000Z",
  "rootDirectory": "/path/to/domains",
  "stats": {
    "totalFiles": 15,
    "processedFiles": 12,
    "brokenFiles": 1,
    "domains": 10,
    "fqidReferences": 23
  },
  "cyclesCount": 2,
  "briefMode": false,
  "cycles": [
    {
      "id": 1,
      "domains": [
        {
          "id": "domain-a",
          "name": "Domain A",
          "filePath": "/path/to/domains/domain-a.ro"
        },
        {
          "id": "domain-b",
          "name": "Domain B",
          "filePath": "/path/to/domains/domain-b.ro"
        }
      ],
      "closingRef": {
        "sourceDomainId": "domain-b",
        "targetDomainId": "domain-a",
        "targetEntityId": "entity-1",
        "fullFQID": "domain-b/entity-1",
        "filePath": "/path/to/domains/domain-b.ro",
        "propertyPath": "some.path"
      },
      "references": [
        {
          "sourceDomainId": "domain-a",
          "targetDomainId": "domain-b",
          "targetEntityId": "entity-2",
          "fullFQID": "domain-a/entity-2",
          "filePath": "/path/to/domains/domain-a.ro",
          "propertyPath": "some.other.path"
        }
      ]
    }
  ]
}
```

Если указан `--brief`, поля `closingRef` и `references` не включаются в отчёт.

---

## Сохранение в файл

С помощью опции `--output <file>` можно сохранить отчёт в файл.

Примеры:

```bash
# Сохранить подробный текстовый отчёт
node find-cycles.js ./domains --output cycles.txt

# Сохранить краткий текстовый отчёт
node find-cycles.js ./domains --brief --output cycles-brief.txt

# Сохранить JSON-отчёт
node find-cycles.js ./domains --json --output cycles.json

# Сохранить краткий JSON-отчёт
node find-cycles.js ./domains --brief --json --output cycles-brief.json
```

---

## Примеры запуска

```bash
# Найти циклы в каталоге ./domains и вывести подробный отчёт
node find-cycles.js ./domains

# Краткий вывод — только домены в циклах
node find-cycles.js ./domains --brief

# Вывести JSON-отчёт в консоль
node find-cycles.js ./domains --json

# Сохранить JSON-отчёт в файл
node find-cycles.js ./domains --json --output cycles.json

# Сохранить подробный текстовый отчёт
node find-cycles.js ./domains --output cycles.txt

# Показать справку
node find-cycles.js --help
```

---

## Обработка ошибок

- Если каталог не существует, скрипт завершится с ошибкой.
- Если файл не удаётся прочитать или распарсить - его путь и сообщение об ошибке выводятся в консоль.
- Ошибки чтения директорий логируются, но не прерывают работу.
