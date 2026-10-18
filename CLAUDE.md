# Material Shell — форк с портом на GNOME 51

Расширение GNOME Shell на TypeScript. Код собирается в `dist/` и работает
внутри процесса `gnome-shell`.

## Документация для разработчиков

Она лежит в [documentation/development](documentation/development) — читай её,
а не восстанавливай устройство проекта по исходникам заново:

| Файл | О чём |
|------|-------|
| [README.md](documentation/development/README.md) | Сборка, как увидеть изменения, вложенный шелл, логи, ветки |
| [FILES.md](documentation/development/FILES.md) | Что где лежит и куда класть новое |
| [ARCHITECTURE.md](documentation/development/ARCHITECTURE.md) | Схемы: жизненный цикл, путь окна, фокус, тема, состояние |
| [PLAYBOOKS.md](documentation/development/PLAYBOOKS.md) | Пути поиска решения по типовым проблемам |
| [TESTING.md](documentation/development/TESTING.md) | Как запускать тесты и как писать новые |
| [REQUIREMENTS.md](documentation/development/REQUIREMENTS.md) | Функциональные требования — чек-лист регрессий |

## Что важно знать до первой правки

- Правка в `src/` не видна, пока шелл не перезапущен. `gnome-extensions
  disable` и `enable` код не перечитывают: шелл кэширует ES-модуль. Проверять
  удобнее во вложенном шелле — раздел
  [«Вложенный шелл»](documentation/development/README.md#вложенный-шелл).
- Сборка — `make compile`, тесты окна настроек — `make test`, тесты внутри
  шелла — `make test-shell` (открывает окно Mdk на несколько секунд, нужен
  `mutter-devkit`), линтер — `make lint`, форматирование — `make format`. Как писать тесты — в
  [TESTING.md](documentation/development/TESTING.md).
- Комментарии в коде — только в крайнем случае. Непонятный код сначала
  переименуй или разбей; подробнее в
  [README.md](documentation/development/README.md#ветки-и-коммиты).
- Object spread и rest (`{...a}`) в `src/` ломают сборку: их не понимает
  esprima внутри `scripts/transpile.ts`. Пиши `Object.assign`.
- Рабочая ветка — `gnome-51`. Задача делается в ветке `issue-N`, сообщения
  коммитов английские, с номером в начале: `issue-9 Throttle stylesheet
  regeneration`.
- Правки фокуса и клавиатуры сверяй с разделом
  [«Залипает клавиша»](documentation/development/PLAYBOOKS.md#залипает-клавиша):
  пока key focus держит актор шелла, Wayland-клиенты не получают клавиш.
