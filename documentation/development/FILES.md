# Структура файлов

Что где лежит и за что отвечает. Как части связаны между собой —
в [ARCHITECTURE.md](ARCHITECTURE.md).

## Корень репозитория

| Путь | Что это |
|------|---------|
| `src/` | Исходники расширения на TypeScript. Разобраны ниже. |
| `schemas/` | gsettings-схемы: `bindings`, `layouts`, `theme`, `tweaks`. Ключ в `metadata.json` — имя схемы, по нему её находит `getSettings()`. |
| `assets/` | Иконки: логотип для заставки, `tiling/` для переключателя раскладок и символьные значки интерфейса. Копируются в `dist/assets` как есть. |
| `tests/` | Проверки окна настроек в отдельном `gjs`. Подробности — [tests/README.md](../../tests/README.md). |
| `scripts/transpile.ts` | Второй шаг сборки: переписывает вывод `tsc` так, чтобы GObject-классы работали в GJS. См. [README](README.md#сборка). |
| `scripts/install.py` | `make install`: делает `~/.local/share/gnome-shell/extensions/material-shell@papyelgringo` символической ссылкой на `dist/` и включает расширение. |
| `@types/` | Типы поверх пакетов `@girs/*`. `ambient.d.ts` подключает объявления `gi://` и `resource:///` из `@girs/gnome-shell` — версия пакета должна совпадать с целевой версией шелла. `shell-internals.d.ts` описывает приватные поля gnome-shell и mutter, которыми мы пользуемся; `shell-modules.d.ts` — модули шелла, которых в `@girs` нет; `mod.d.ts` — глобальные объявления и дополнения к типам GObject, Clutter, Soup. |
| `metadata.json` | Метаданные расширения. `{put_commit_there}` при сборке заменяется коротким хешем коммита. |
| `Makefile` | Точка входа сборки: `compile`, `install`, `test`, `build_prod`. |
| `rollup.config.js`, `rollup.config.prefs.js` | Сборка `build/` в два файла, `dist/extension.js` и `dist/prefs.js`, с разрешением алиаса `src/`. |
| `tsconfig.json` | `target: es2018`, строгий режим, типы только из `@girs/*` и `@types/`. |
| `documentation/` | Картинки и письмо для пользователей из основного README. Документация для разработчиков — в `docs/development/`. |
| `.eslintrc.js`, `.prettierrc`, `.editorconfig` | Стиль кода: четыре пробела в коде, два — в документации. |

Генерируется и в git не попадает:

| Путь | Что это |
|------|---------|
| `build/` | Вывод `tsc` и `transpile.ts`, промежуточный. |
| `dist/` | Готовое расширение. На него указывает ссылка из `~/.local/share/gnome-shell/extensions/`. |
| `scripts/build/` | Старый вывод `transpile.ts`. Сейчас он собирается в `build/transpile.js`. |

Осталось от прошлых этапов и в сборке не участвует:

| Путь | Что это |
|------|---------|
| `@gi-types/`, `docs.json`, `scripts/generate_types.py` | Генерация типов через gi.ts. Теперь типы берутся из пакетов `@girs/*` в `node_modules`. |
| `src/prefs/prefs-gtk3.ts.old`, `prefs-gtk4.ts.old` | Прежние окна настроек. `tsconfig.json` их не включает. |

## `src/`

Импорты внутри проекта пишутся от корня: `import { … } from 'src/manager/…'`.
Алиас `src` разрешает rollup.

### Точка входа

| Файл | Что делает |
|------|------------|
| `extension.ts` | `MaterialShellExtension`: `enable()` и `disable()`, заставка при старте. Статические геттеры (`Me.msWindowManager`, `Me.layout`, …) — единственный способ добраться до менеджеров из любого места. |

### `manager/` — долгоживущие службы

Создаются в `enable()` и живут до `disable()`. Большинство наследуют
`MsManager`: его `observe()` запоминает подключённые сигналы, и `destroy()`
отключает их все разом.

| Файл | Что делает |
|------|------------|
| `msManager.ts` | Базовый класс `MsManager` с `observe()` и `destroy()`. |
| `stateManager.ts` | Сохранённое состояние: читает и пишет JSON в `global.set_persistent_state('material-shell-state')`. |
| `msWindowManager.ts` | Получает каждое новое окно mutter (`Meta.Window`), решает, берёт ли его Material Shell, и сопоставляет с `MsWindow`. Создаёт трёх помощников ниже. |
| `msFocusManager.ts` | Следит за key focus сцены и фокусом окна mutter, сообщает `focus-changed`. Обёртки над `Main.pushModal`/`popModal`. |
| `msDndManager.ts` | Перетаскивание плиток мышью между позициями и столами. |
| `msResizeManager.ts` | Изменение размеров плиток мышью на границах. |
| `msWorkspaceManager.ts` | Список `MsWorkspace`: по одному на каждый стол основного монитора и по одному на каждый внешний монитор. Подменяет `_checkWorkspaces` у `WorkspaceTracker` шелла. Реагирует на смену мониторов. |
| `layoutManager.ts` | Реестр раскладок (`TilingLayoutByKey`), общие настройки отступов и пропорций, `tileWindows()`. |
| `msThemeManager.ts` | Настройки темы: собирает CSS из `dist/style-*-theme.css`, подставляет цвет и прозрачности, перезагружает стиль. Испускает `*-changed` для панелей. |
| `msNotificationManager.ts` | Запрашивает новости проекта с `api.material-shell.com` и показывает их уведомлениями. Отключается ключом `tweaks/disable-notifications`. |
| `tooltipManager.ts` | Всплывающие подсказки у вкладок таскбара и кнопок лаунчера. |
| `appsManager.ts` | Список установленных приложений, отсортированный по частоте использования. Для лаунчера. |

### `module/` — вмешательство в шелл

Модули меняют поведение самого GNOME Shell и в `destroy()` возвращают всё
как было.

| Файл | Что делает |
|------|------------|
| `hotKeysModule.ts` | Регистрирует хоткеи из схемы `bindings` через `Main.wm.addKeybinding`. Действия собраны в `KeyBindingAction`. |
| `requiredSettingsModule.ts` | Навязывает `org.gnome.mutter workspaces-only-on-primary=true` и `button-layout=appmenu:close`. Снимает стандартные сочетания шелла, которые конфликтуют с нашими, и восстанавливает их при выключении. |
| `overrideModule.ts` | Отключает анимации окон шелла (`WindowManager._shouldAnimate`), подменяет `Meta.prefs_get_workspaces_only_on_primary`. |
| `disableIncompatibleExtensionsModule.ts` | Выключает dash-to-dock, ubuntu-dock, desktop-icons, pop-shell и другие несовместимые расширения и не даёт им включиться. |

### `layout/` — то, что видно на экране

| Путь | Что делает |
|------|------------|
| `main.ts` | `MsMain` — корневой актёр. Вставляется в `Main.layoutManager.uiGroup` над `global.window_group`. По одному `MonitorContainer` на монитор; основной (`PrimaryMonitorContainer`) несёт и вертикальную панель. Обзор по клавише `Super`. |
| `msWorkspace/msWorkspace.ts` | `MsWorkspace` — модель одного стола: список плиток (`tileableList`: окна и лаунчер), фокус, история фокуса, текущая раскладка. `MsWorkspaceActor` — его актёр с горизонтальной панелью. |
| `msWorkspace/msWindow.ts` | `MsWindow` — актёр-плитка вокруг окна приложения (`Meta.Window`) и его диалогов. Хранит состояние жизненного цикла, двигает и масштабирует настоящее окно под свою аллокацию. |
| `msWorkspace/msWorkspaceCategory.ts` | Категория стола по приложениям на нём (Development, Game, …). Отвечает за иконку в списке столов. |
| `msWorkspace/portion.ts` | Дерево пропорций для раскладок с изменяемыми размерами. |
| `msWorkspace/tilingLayouts/baseTiling.ts` | `BaseTilingLayout` — основа всех раскладок: подписка на изменения списка и фокуса, `tileAll()`, показ лаунчера. |
| `msWorkspace/tilingLayouts/baseResizeableTiling.ts` | Раскладки на `Portion` с перетаскиваемыми границами. |
| `msWorkspace/tilingLayouts/{maximize,split,float}.ts` | Самостоятельные раскладки. |
| `msWorkspace/tilingLayouts/custom/*.ts` | Раскладки поверх `baseResizeableTiling`: grid, half и её варианты, ratio, simple и её варианты. |
| `msWorkspace/horizontalPanel/` | Панель стола: `taskBar.ts` (вкладки окон), `layoutSwitcher.ts` (выбор раскладки). |
| `verticalPanel/verticalPanel.ts` | `MsPanel` — левая панель: кнопка поиска, список столов, системная область. |
| `verticalPanel/workspaceList.ts` | Кнопки столов с перетаскиванием и индикатором активного стола. |
| `verticalPanel/statusArea.ts` | Забирает индикаторы и меню даты из верхней панели шелла (`Main.panel`) в вертикальную панель и возвращает их при выключении. |
| `verticalPanel/extendedPanelContent.ts`, `searchResultList.ts`, `search/` | Раскрытая панель с поиском. Поставщики: приложения, удалённые (D-Bus) поставщики шелла, недавнее с учётом контекста. |

### `widget/` — переиспользуемые актёры

| Файл | Что делает |
|------|------------|
| `material/button.ts`, `divider.ts`, `numberPicker.ts`, `rippleBackground.ts` | Кнопка с «рябью» Material Design и мелкие элементы. |
| `msApplicationLauncher.ts` | Лаунчер приложений — плитка, которая стоит последней на каждом столе. |
| `appPlaceholder.ts` | Заглушка на месте окна, которое ещё не открылось или было восстановлено из сохранённого состояния. |
| `reorderableList.ts` | Список с перестановкой элементов перетаскиванием. |

### `prefs/`

| Файл | Что делает |
|------|------------|
| `prefs.ts` | Окно настроек на libadwaita: страницы Settings и Hotkeys, строки привязаны к ключам схем. Собирается отдельно в `dist/prefs.js` и работает в процессе приложения «Расширения», не в шелле. |

### `styles/`

| Файл | Что делает |
|------|------------|
| `stylesheet.scss` | Весь CSS. Вверху три значения-метки: `$color-primary: #3f51b5`, `$panel-opacity: 0.876`, `$surface-opacity: 0.987`. `MsThemeManager` находит их в готовом CSS текстом и заменяет настройками пользователя, поэтому их нельзя менять. |
| `dark-theme.scss`, `light-theme.scss`, `primary-theme.scss` | Задают `$theme` и подключают `stylesheet.scss`. Дают три файла `dist/style-*-theme.css`. |
| `typography.scss`, `margins.scss` | Общие миксины. |

### `utils/`

| Файл | Что делает |
|------|------------|
| `gjs.ts` | `registerGObjectClass` — декоратор GObject-классов; `WithSignals` — сигналы для обычных JS-классов. |
| `signal.ts` | `SignalHandle` и `SignalObserver` — подключение сигналов с гарантированным отключением. |
| `settings.ts` | `getSettings('theme' \| 'layouts' \| 'tweaks' \| 'bindings')`. |
| `debug.ts`, `log.ts` | `Debug.log` → journal с доменом `Material Shell`; `logAsyncException` для промисов. |
| `async.ts`, `idle_debounce.ts`, `index.ts` | Таймеры, которые снимаются при `disable()` (`Async`), debounce, `throttle`, `reparentActor`. |
| `assert.ts`, `predicates.ts` | `assert`, `assertNotNull`, `isNonNull`. |
| `weighted_matching.ts` | Венгерский алгоритм. `MsWindowManager` сопоставляет им окна с плитками. |
| `transition.ts` | `TranslationHelper` — анимация сдвига при переключении столов и окон. |
| `styling_utils.ts` | `invalidate_style_recursively` — сброс кэша стиля у отсоединённых поддеревьев. |
| `shellVersionMatch.ts` | Сравнение версий GNOME: `gnomeVersionNumber`, `compareVersions`. |
| `windows.ts` | Заголовок окна: показать или скрыть. |
| `compatibility.ts` | Старые имена клавиш в `Clutter`. |
| прочие | `group_by.ts`, `diff_list.ts`, `layout.ts`, `profile.ts`, `shellTypes.ts`, `extension_utils.ts` — мелкие помощники. |

## Куда класть новое

| Что добавляете | Куда | Что ещё тронуть |
|----------------|------|-----------------|
| Настройку | Ключ в `schemas/*.gschema.xml` | Строку в `src/prefs/prefs.ts`; `observe(settings, 'changed::ключ')` в менеджере, который её применяет. |
| Хоткей | Ключ в схеме `bindings` | `KeyBindingAction` и действие в `hotKeysModule.ts`. Строка в prefs появится сама: `buildHotkeysGroup()` перечисляет все ключи схемы, заголовок берётся из `<summary>`. |
| Раскладку | `src/layout/msWorkspace/tilingLayouts/` | Массив `layouts`, тип `LayoutState` и `createLayout()` в `layoutManager.ts`; булев ключ с `key` раскладки в схеме `layouts`; `key` в список `tilingLayouts` в `prefs.ts`; иконку `assets/icons/tiling/<key>-symbolic.svg`. Пошагово — в [PLAYBOOKS.md](PLAYBOOKS.md#добавить-раскладку). |
| Службу, живущую всё время работы | `src/manager/`, наследник `MsManager` | Создание в `enable()`, `destroy()` в `disable()`, статический геттер в `extension.ts`. |
| Подмену функции шелла | `src/module/` | Вернуть оригинал в `destroy()`; внести в список в [PLAYBOOKS.md](PLAYBOOKS.md#порт-под-новую-версию-gnome). |
| Цвет или отступ | `src/styles/stylesheet.scss` | Только через переменные вверху файла. |
