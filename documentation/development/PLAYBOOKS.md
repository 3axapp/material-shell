# Пути поиска решения

С чего начинать в типовых ситуациях. Каждый пункт построен одинаково:
признаки, куда смотреть, как проверить и чем такое кончалось раньше.
Как устроены части, которые здесь упоминаются, описано в
[ARCHITECTURE.md](ARCHITECTURE.md).

Проверки кода расширения начинайте во
[вложенном шелле](README.md#вложенный-шелл): он загружает свежий `dist/`
без перезахода. Настоящая сессия нужна для финальной проверки и для того, что
вложенный шелл не воспроизводит, — прежде всего клавиатуры и фокуса
Wayland-клиентов. Перезаход дорог, поэтому идите в него с готовой гипотезой и
планом, что именно смотреть.

## Цикл разработки и отладка

### Правка не видна

- Проверьте, что сборка обновила `dist/` (`ls -l dist/extension.js`) и что
  место установки — ссылка на него:
  `ls -l ~/.local/share/gnome-shell/extensions/material-shell@papyelgringo`.
- `gnome-extensions disable` и `enable` новый код не подхватывают: шелл
  кэширует ES-модуль. Нужен [вложенный шелл](README.md#вложенный-шелл)
  или перезаход.
- Какая сборка сейчас загружена, видно в Looking Glass:
  `global.ms.metadata.commit`. Это хеш `HEAD` на момент сборки. Незакоммиченные
  правки он не отражает.

### Сборка падает на transpile

Признаки: `make compile` пишет `Failed to parse build/…js` и
`Writing converted text to temp.js`, дальше идёт ошибка esprima вроде
`Unexpected token ...`.

- Номер строки в ошибке относится к выводу `tsc`, а не к исходнику. Откройте
  `temp.js` в корне на этой строке и найдите такое же место в `src/`.
- Почти всегда виноват object spread или rest: `{...a}`, `const {x, ...rest} = a`.
  `tsc` при `target: es2018` оставляет их как есть, а esprima 4 внутри
  transpile их не знает. Замените на `Object.assign({}, a)` или явное
  копирование.
- `temp.js` в `.gitignore` не входит — удалите его.

### Нужно понять, что происходит внутри

- **Логи.** `journalctl -b -f -o cat /usr/bin/gnome-shell`. Исключения из
  JS идут со строкой `JS ERROR` и стеком.
- **Looking Glass** (`Alt+F2` → `lg`). Состояние видно без перезахода:
  - `global.ms.msWorkspaceManager.msWorkspaceList`;
  - `global.stage.key_focus`;
  - `global.display.focus_window`;
  - `global.ms.stateManager.state`.
- **Временный зонд.** Вынесите его в отдельный файл, например
  `src/utils/probeN.ts`, с собственным доменом:
  `GLib.log_structured('MS42', GLib.LogLevelFlags.LEVEL_MESSAGE, { MESSAGE: … })`.
  Читается так: `journalctl -b -f -o cat 'GLIB_DOMAIN=MS42'`. Всё, что
  нужно убрать перед коммитом, лежит в одном файле, плюс вызовы из него.
- **Заметки.** Если для расследования нужно несколько перезаходов, записывайте
  гипотезы, отброшенные варианты и результаты замеров в файл вне git.
  Падение шелла на Wayland закрывает сессию вместе со всем, что было открыто.

### Шелл упал или сессия закрылась сама

- Логи прошлой попытки: `journalctl -b -o cat /usr/bin/gnome-shell`,
  ищите последние `JS ERROR` и `Bail out` перед выходом.
- Если это был сбой в C: `coredumpctl list gnome-shell` и `coredumpctl info`.
- Открытая задача такого рода —
  [#3](https://github.com/3axapp/material-shell/issues/3).

### Нужно прочитать исходники шелла или mutter

JS-файлы шелла вшиты ресурсами в `libshell-N.so`, где `N` — номер API mutter:
`ls /usr/lib/gnome-shell`. Утилиты `gresource` может не быть, а обычный
`gjs` ресурсы не видит. Работает так:

```sh
python3 -c "
import ctypes; ctypes.CDLL('/usr/lib/gnome-shell/libshell-18.so')
from gi.repository import Gio
print(Gio.resources_lookup_data('/org/gnome/shell/ui/main.js', 0).get_data().decode())
" > main.js
```

Список файлов: `Gio.resources_enumerate_children('/org/gnome/shell/ui/', 0)`.

- **Сигнатуры** классов шелла и GI-библиотек — в
  `node_modules/@girs/*/*.d.ts`. Версия `@girs/gnome-shell` в `package.json`
  должна совпадать с версией шелла.
- **mutter** — это C. Берите исходники той же версии, что установлена
  (`pacman -Q mutter` или аналог), с gitlab.gnome.org/GNOME/mutter. Как
  mutter раздаёт клавиатурные события, описано в `src/core/events.c`.

## Ввод и фокус

### Залипает клавиша

Признаки: после сочетания клавиш одна буква бесконечно повторяется в
приложении (чаще под XWayland) или клавиша «нажата», пока её не нажмут снова.

- **Причина почти всегда одна.** Пока key focus держит актёр шелла или поднят
  grab (`Main.pushModal`, `global.stage.grab`), mutter не передаёт клавиши
  Wayland-клиентам. Если это случилось между нажатием и отпусканием
  сочетания, окно никогда не узнает об отпускании.
- **Где искать.** В коде, который срабатывает по хоткею и трогает фокус:
  - `MsWorkspace.activate()`, `refreshFocus()`, `focusTileable()` →
    `grab_key_focus()` у заглушки или лаунчера;
  - восстановление фокуса в `MsFocusManager.onKeyFocus()` при
    `focusProtected`;
  - `pushModal` в обзоре `MsMain`.
- **Как проверить.**
  - В Looking Glass `global.stage.key_focus` сразу после переключения:
    если там наш актёр, а не `null`, клавиши к окну не идут.
  - Воспроизводить на XWayland-приложении: оно считает клавишу нажатой
    и повторяет её, так что залипание сразу видно.
  - Отдельно проверить несколько мониторов.
  - Проверять в настоящей сессии: во вложенном шелле клавиатура приходит
    через окно Mdk, и залипания там не проверялись.
- **Прецеденты.**
  - [#2](https://github.com/3axapp/material-shell/issues/2), коммит
    `a933877`: фокус возвращался на лаунчер стола, с которого только что
    ушли.
  - [#10](https://github.com/3axapp/material-shell/issues/10), ветка
    `issue-10`: переключение стола забирало фокус на заглушку или лаунчер.
    Решение — вообще не брать клавиатуру при переключении и оставить выбор
    окна mutter.
- **Правило для новых правок.** Прежде чем ставить key focus на актёр или
  брать grab, ответьте, когда и как фокус вернётся к окну. «Никогда, пока
  пользователь не кликнет» — тоже ответ, но тогда делайте это не из
  обработчика хоткея.

### Добавить хоткей

1. Ключ типа `as` в `schemas/org.gnome.shell.extensions.materialshell.bindings.gschema.xml`.
   `<summary>` станет подписью в настройках.
2. Имя в `KeyBindingAction` и действие в `actionNameToActionMap` в
   `src/module/hotKeysModule.ts`. Регистрация пройдёт сама:
   `Main.wm.addKeybinding`, флаг `IGNORE_AUTOREPEAT`, режим
   `Shell.ActionMode.NORMAL`.
3. Строка в окне настроек появится сама: `buildHotkeysGroup()` перечисляет
   все ключи схемы.

Если хоткей не срабатывает:

- **Сочетание занято.** `RequiredSettingsModule` при включении снимает
  стандартные сочетания шелла и mutter, совпадающие с нашими, но сравнивает
  только первое сочетание из списка.
- **Не тот режим.** В обзоре и при модальных диалогах действует другой
  `ActionMode`, и наши хоткеи там молчат.

## Внешний вид и настройки

### Тема или прозрачность перестали применяться

Признаки: изменения цвета, темы или прозрачности не видны до перезахода.
В журнале `JS ERROR` из `Main.loadTheme()`.

- **Где.** `MsThemeManager.regenerateStylesheet()`. Между
  `unloadStylesheet()` и `load_stylesheet()` не должно быть `await`. Частые
  изменения должны идти через `throttledRegenerateStylesheet()`.
- **Как проверить.** В Looking Glass:
  `St.ThemeContext.get_for_stage(global.stage).get_theme().get_custom_stylesheets()`.
  `null` в списке значит, что `St.Theme` уже испорчен, и до перезахода это
  не лечится.
- **Прецедент.** [#9](https://github.com/3axapp/material-shell/issues/9),
  коммиты `d16f6f4` и `dcde4f7`.

### Часть интерфейса выглядит без стилей после смены темы

Признаки: чёрный текст, пропавшие отступы — но только у актёров, которые в
момент смены темы были не на экране (другой стол).

- **Где.** St пересчитывает стили только у актёров, прикреплённых к сцене.
  Столы основного монитора, кроме текущего, из сцены вынимаются. Их надо
  сбрасывать вручную: `invalidate_style_recursively()` в обработчике
  `St.ThemeContext::changed` в `MsThemeManager`.
- **Прецедент.** [#1](https://github.com/3axapp/material-shell/issues/1),
  коммит `db42290`. Если заводите новые актёры, которые живут вне сцены,
  добавьте их в тот же сброс.

### Добавить цвет или прозрачность, которые меняет пользователь

CSS собирается при сборке, а значения пользователя подставляются во время
работы заменой текста (`buildThemeStylesheetToFile()`):

1. Переменная в начале `src/styles/stylesheet.scss` со значением-меткой,
   которое больше нигде в CSS не встречается. Проверьте это по готовым
   `dist/style-*-theme.css`.
2. Замена этой метки в `buildThemeStylesheetToFile()`.
3. Ключ в схеме `theme`, `observe(…, 'changed::ключ')` в `MsThemeManager`,
   который вызывает `throttledRegenerateStylesheet()`.
4. Строка в `buildThemeGroup()` в `prefs.ts`.

### Окно настроек выглядит обрезанным

Запустите `gjs -m tests/prefs-measure.js` после `make compile`. Он печатает
запрошенную ширину каждого виджета деревом и показывает, кто её раздувает.
Прецедент — [#8](https://github.com/3axapp/material-shell/issues/8);
подробности в [TESTING.md](TESTING.md#тесты-окна-настроек).

### Добавить настройку

1. Ключ в нужной схеме в `schemas/`. У чисел задайте `<range>`: он
   ограничивает любого, кто пишет ключ, а `addSpinRow()` берёт границы из
   него. Прецедент — [#11](https://github.com/3axapp/material-shell/issues/11),
   коммит `c7e1fce`: у прозрачности не было диапазона, и окно предлагало
   0–1000.
2. Строка в нужной группе `prefs.ts`: `addSwitchRow`, `addSpinRow`,
   `addEnumComboRow`, `addColorRow`, `addEntryRow`. Подпись берётся из
   `<summary>`.
3. Применение в шелле: `observe(settings, 'changed::ключ', …)` в менеджере,
   который за это отвечает, и начальное значение в его конструкторе.
4. `make test` — `tests/prefs-check.js` проверяет, что каждая строка читает
   и пишет свой ключ.

## Окна, столы и раскладки

### Окно попало не туда или не в ту плитку

Идите по пути окна ([ARCHITECTURE.md](ARCHITECTURE.md#путь-окна)) и
проверяйте каждый шаг:

1. **Взяли ли окно вообще.** `MsWindowManager.handleWindow()`: исключения
   `windows-excluded` и `roles-excluded` из схемы `layouts`, окна «поверх
   всех», тип окна.
2. **Не посчитали ли его диалогом.** `isMetaWindowDialog()`: у окна есть
   `transient_for`, оно не меняет размер или «заморожено». Такое окно
   прикрепляется к чужой плитке, а не получает свою.
3. **На какой стол.** `determineAppropriateMsWorkspace()` — монитор и стол
   окна в момент создания. Первые 2 секунды
   `metaWindowEnteredWorkspace()` возвращает окно на прежний стол, а
   `setWindowToMsWorkspaceWithCreationChaosProtection()` 200 мс гасит
   прыжки между мониторами.
4. **С какой заглушкой сопоставили.** При пересопоставлении
   `assignNonDialogWindows()` пишет в журнал строки `Meta window: …` и
   `MSWindow: …` — по ним видно, из чего выбирали.

Открытая задача рядом — [#4](https://github.com/3axapp/material-shell/issues/4),
окна открываются с нулевой высотой.

### После перезахода окна восстановились неправильно

- **Что сохранено.** В Looking Glass:
  `global.ms.stateManager.state['workspaces-state']`. У каждой плитки есть
  `matchingInfo`: приложение, `wmClass`, `pid`, `title`, `stableSeq`.
- **Как выбирается плитка.** Функция стоимости — `windowMatchingCost()` в
  `msWindowManager.ts`. `wmClass` обязан совпасть, остальное лишь добавляет
  стоимость.
- **Когда не сохраняется.** Пока идёт восстановление или меняются мониторы,
  сохранение пропускается.
- **Сброс.** Если состояние испорчено, сбросьте его — см. основной
  [README](../../README.md#reset-material-shell).

### Несколько мониторов

- При подключении и отключении мониторов работает
  `MsWorkspaceManager.onMonitorsChanged()`:
  - внешний монитор получает свободный «внешний» `MsWorkspace` или новый;
  - столы отключённого монитора переезжают в конец столов основного.
- Пока `updatingMonitors`, сохранение и перенос окон между столами
  отключены.
- Второй монитор без железа добавляет флаг `--virtual-monitor` у вложенного
  шелла ([README](README.md#вложенный-шелл)), но в окне Mdk виден только его
  собственный монитор: состояние второго смотрите по логам и зондом.
  Клавиатуру так проверить нельзя, см. ниже.
- Проверяйте фокус и клавиатуру отдельно на каждом мониторе: лаунчер
  внешнего монитора может забрать key focus, когда там закрывается последнее
  окно ([#10](https://github.com/3axapp/material-shell/issues/10)).

### Добавить раскладку

1. **Класс.** Файл в `src/layout/msWorkspace/tilingLayouts/` (или в
   `custom/`), наследник `BaseTilingLayout` или `BaseResizeableTilingLayout`.
   Статическое `state` задаёт `key`. Размещение плиток — в
   `tileTileable(tileable, box, index, siblingLength)`.
2. **Регистрация в `layoutManager.ts`:** массив `layouts`, объединения
   `LayoutState` и `LayoutType`, ветка в `createLayout()`.
3. **Схема `layouts`:** булев ключ с именем, равным `key`.
4. **Окно настроек:** `key` в список `tilingLayouts` в начале `prefs.ts`.
5. **Иконка:** `assets/icons/tiling/<key>-symbolic.svg`.

### Порт под новую версию GNOME

1. Обновите `@girs/gnome-shell` и остальные `@girs/*` до новой версии и
   `shell-version` в `metadata.json`. Ошибки `tsc` покажут изменившиеся API
   GI-библиотек.
2. Приватные части шелла `tsc` не проверит: их типы описаны вручную в
   `@types/shell-internals.d.ts`. Сверьте каждую с исходниками новой версии
   (как их читать — [выше](#нужно-прочитать-исходники-шелла-или-mutter)):

   | Что используем | Где |
   |----------------|-----|
   | `Main.wm._workspaceTracker`: `_checkWorkspaces`, `_checkWorkspacesId`, `_queueCheckWorkspaces`, `_workspaces` | `msWorkspaceManager.ts` |
   | `Meta.Workspace._keepAliveId`, `_lastRemovedWindow` | `msWorkspaceManager.ts` |
   | `WindowManager.prototype._shouldAnimate` | `overrideModule.ts` |
   | `ExtensionManager.prototype._callExtensionEnable` | `disableIncompatibleExtensionsModule.ts` |
   | `Main.layoutManager._startingUp`, `_trackActor`, `_untrackActor`, `_findActor` | `extension.ts`, `layout/main.ts` |
   | `Main.panel._leftBox`, `_centerBox`, `_rightBox`, `menuManager._menus`; `DateMenuButton._clockDisplay`, `_indicator` | `layout/verticalPanel/statusArea.ts` |
   | Поля пунктов `PopupMenu`: `_icon`, `_parent`, `_statusBin` | `layoutSwitcher.ts`, `workspaceList.ts` |
   | `Dialog.MessageDialogContent._description` | `msNotificationManager.ts` |
   | `Main.modalActorFocusStack` и имя класса `AuthenticationDialog` | `msWindowManager.ts` |

3. Пройдите заново сценарии из этого файла: переключение столов с окном и
   без, несколько мониторов, смена темы, окно настроек, восстановление после
   перезахода.
4. Новое поведение шелла, которое мы подменяем, описывайте в комментарии у
   подмены: почему так и с какой версии. Пример — комментарий о
   `AuthenticationDialog` в `checkWindowsForAssignations()`.
