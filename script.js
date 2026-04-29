const STORAGE_KEY = 'pomelo-focus-timer-state'
const RING_LENGTH = 603.19
const MAX_SAVED_PRESETS = 12

const MODES = {
  focus: { label: 'Focus Session', next: 'break' },
  shortBreak: { label: 'Short Break', next: 'focus' },
  longBreak: { label: 'Long Break', next: 'focus' },
}

const DEFAULTS = {
  durations: {
    focus: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
  },
  cyclesUntilLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  soundVolume: 70,
  completedFocusSessions: 0,
  savedPresets: [],
}

const state = {
  mode: 'focus',
  isRunning: false,
  completedCycles: 0,
  remainingSeconds: DEFAULTS.durations.focus,
  totalSeconds: DEFAULTS.durations.focus,
  intervalId: null,
  animationFrameId: null,
  endTimeMs: null,
  completionTimeoutId: null,
  lastAnnouncedSecond: null,
  settings: structuredClone(DEFAULTS),
}

const elements = {
  body: document.body,
  modeLabel: document.getElementById('modeLabel'),
  timeDisplay: document.getElementById('timeDisplay'),
  cycleLabel: document.getElementById('cycleLabel'),
  completedCount: document.getElementById('completedCount'),
  longBreakCountdown: document.getElementById('longBreakCountdown'),
  startPauseButton: document.getElementById('startPauseButton'),
  resetButton: document.getElementById('resetButton'),
  skipButton: document.getElementById('skipButton'),
  openSettingsButton: document.getElementById('openSettingsButton'),
  closeSettingsButton: document.getElementById('closeSettingsButton'),
  settingsModal: document.getElementById('settingsModal'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  saveSettingsButton: document.getElementById('saveSettingsButton'),
  savePresetButton: document.getElementById('savePresetButton'),
  progressRing: document.querySelector('.ring-progress'),
  presetList: document.getElementById('presetList'),
  presetName: document.getElementById('presetName'),
  statusMessage: document.getElementById('statusMessage'),
  soundVolumeValue: document.getElementById('soundVolumeValue'),
  modeTabs: [...document.querySelectorAll('.mode-tab')],
  inputs: {
    focusMinutes: document.getElementById('focusMinutes'),
    focusSeconds: document.getElementById('focusSeconds'),
    shortBreakMinutes: document.getElementById('shortBreakMinutes'),
    shortBreakSeconds: document.getElementById('shortBreakSeconds'),
    longBreakMinutes: document.getElementById('longBreakMinutes'),
    longBreakSeconds: document.getElementById('longBreakSeconds'),
    cyclesUntilLongBreak: document.getElementById('cyclesUntilLongBreak'),
    autoStartBreaks: document.getElementById('autoStartBreaks'),
    autoStartFocus: document.getElementById('autoStartFocus'),
    soundEnabled: document.getElementById('soundEnabled'),
    soundVolume: document.getElementById('soundVolume'),
  },
}

function normalizeSettings(rawSettings = {}) {
  const rawDurations = rawSettings.durations ?? {}
  const usesSecondUnit = rawSettings.durationUnit === 'seconds'

  return {
    ...DEFAULTS,
    ...rawSettings,
    durations: {
      focus: normalizeDurationValue(rawDurations.focus, DEFAULTS.durations.focus, usesSecondUnit),
      shortBreak: normalizeDurationValue(
        rawDurations.shortBreak,
        DEFAULTS.durations.shortBreak,
        usesSecondUnit,
      ),
      longBreak: normalizeDurationValue(
        rawDurations.longBreak,
        DEFAULTS.durations.longBreak,
        usesSecondUnit,
      ),
    },
    durationUnit: 'seconds',
    soundVolume: clampNumber(rawSettings.soundVolume, 0, 100, DEFAULTS.soundVolume),
    savedPresets: normalizeSavedPresets(rawSettings.savedPresets),
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw)
    state.settings = normalizeSettings(parsed.settings)
    state.completedCycles = Number(parsed.completedCycles) || 0
    state.mode = MODES[parsed.mode] ? parsed.mode : 'focus'
  } catch {
    state.settings = structuredClone(DEFAULTS)
  }

  applyMode(state.mode, false)
}

function saveState() {
  const payload = {
    mode: state.mode,
    completedCycles: state.completedCycles,
    settings: state.settings,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function syncInputs() {
  const focus = splitDuration(state.settings.durations.focus)
  const shortBreak = splitDuration(state.settings.durations.shortBreak)
  const longBreak = splitDuration(state.settings.durations.longBreak)

  elements.inputs.focusMinutes.value = focus.minutes
  elements.inputs.focusSeconds.value = focus.seconds
  elements.inputs.shortBreakMinutes.value = shortBreak.minutes
  elements.inputs.shortBreakSeconds.value = shortBreak.seconds
  elements.inputs.longBreakMinutes.value = longBreak.minutes
  elements.inputs.longBreakSeconds.value = longBreak.seconds
  elements.inputs.cyclesUntilLongBreak.value = state.settings.cyclesUntilLongBreak
  elements.inputs.autoStartBreaks.checked = state.settings.autoStartBreaks
  elements.inputs.autoStartFocus.checked = state.settings.autoStartFocus
  elements.inputs.soundEnabled.checked = state.settings.soundEnabled
  elements.inputs.soundVolume.value = state.settings.soundVolume
  elements.soundVolumeValue.textContent = `${state.settings.soundVolume}%`
  renderPresetList()
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function updateProgress(remainingSeconds = state.remainingSeconds) {
  const ratio = state.totalSeconds === 0 ? 0 : remainingSeconds / state.totalSeconds
  const offset = RING_LENGTH * (1 - ratio)
  elements.progressRing.style.strokeDashoffset = String(offset)
}

function updateStats() {
  const currentCycle = (state.completedCycles % state.settings.cyclesUntilLongBreak) + 1
  const remainingToLongBreak =
    state.settings.cyclesUntilLongBreak - (state.completedCycles % state.settings.cyclesUntilLongBreak)

  elements.cycleLabel.textContent = `Cycle ${currentCycle} / ${state.settings.cyclesUntilLongBreak}`
  elements.completedCount.textContent = String(state.settings.completedFocusSessions)
  elements.longBreakCountdown.textContent = String(remainingToLongBreak)
}

function render() {
  elements.body.dataset.mode = state.mode
  elements.modeLabel.textContent = MODES[state.mode].label
  elements.timeDisplay.textContent = formatTime(state.remainingSeconds)
  elements.startPauseButton.textContent = state.isRunning ? 'Pause' : 'Start'
  elements.modeTabs.forEach((button) => {
    const selected = button.dataset.mode === state.mode
    button.classList.toggle('is-active', selected)
    button.setAttribute('aria-selected', selected ? 'true' : 'false')
  })
  updateProgress()
  updateStats()
}

function openSettings() {
  elements.settingsModal.classList.add('is-open')
  elements.settingsModal.setAttribute('aria-hidden', 'false')
}

function closeSettings() {
  elements.settingsModal.classList.remove('is-open')
  elements.settingsModal.setAttribute('aria-hidden', 'true')
}

function renderPresetList() {
  const presets = state.settings.savedPresets
  if (!presets.length) {
    elements.presetList.innerHTML = '<span class="preset-empty">保存済みプリセットはまだありません。</span>'
    return
  }

  elements.presetList.innerHTML = presets
    .map(
      (preset) => `
        <div class="preset-chip" data-preset-id="${preset.id}">
          <button type="button" class="preset-chip-main" data-preset-load="${preset.id}">
            <span class="preset-chip-name">${escapeHtml(preset.name)}</span>
            <span class="preset-chip-meta">${formatPresetSummary(preset)}</span>
          </button>
          <button type="button" class="preset-delete" data-preset-delete="${preset.id}" aria-label="${escapeHtml(
            preset.name,
          )} を削除">×</button>
        </div>
      `,
    )
    .join('')
}

function stopTimer() {
  if (state.intervalId) {
    clearInterval(state.intervalId)
    state.intervalId = null
  }
  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId)
    state.animationFrameId = null
  }
  if (state.completionTimeoutId) {
    clearTimeout(state.completionTimeoutId)
    state.completionTimeoutId = null
  }
  state.endTimeMs = null
  state.lastAnnouncedSecond = null
  state.isRunning = false
}

function notifyModeSwitch(message) {
  elements.statusMessage.textContent = message

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(message)
  }

}

function playToneSequence(steps) {
  if (state.settings.soundVolume <= 0) return

  const context = new (window.AudioContext || window.webkitAudioContext)()
  const totalDuration = steps[steps.length - 1].start + steps[steps.length - 1].duration
  const volumeScale = state.settings.soundVolume / 100

  steps.forEach((step) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startAt = context.currentTime + step.start

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(step.frequency, startAt)
    gain.gain.setValueAtTime(0.001, startAt)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, step.volume * volumeScale), startAt + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + step.duration)

    oscillator.connect(gain)
    gain.connect(context.destination)

    oscillator.start(startAt)
    oscillator.stop(startAt + step.duration)
  })

  window.setTimeout(() => {
    context.close().catch(() => {})
  }, (totalDuration + 0.1) * 1000)
}

function playCountdownChime() {
  playToneSequence([
    { start: 0, duration: 0.16, frequency: 740, volume: 0.1 },
  ])
}

function playCompletionChime() {
  playToneSequence([
    { start: 0, duration: 0.82, frequency: 932, volume: 0.15 },
  ])
}

function handleTimerCompletion() {
  stopTimer()
  state.remainingSeconds = 0
  render()

  if (state.settings.soundEnabled) {
    playCompletionChime()
  }

  state.completionTimeoutId = window.setTimeout(() => {
    state.completionTimeoutId = null
    advanceMode()
  }, 900)
}

function applyMode(mode, shouldRender = true) {
  state.mode = mode
  state.totalSeconds = state.settings.durations[mode]
  state.remainingSeconds = state.totalSeconds
  if (shouldRender) render()
  saveState()
}

function chooseNextMode(countFocusCompletion) {
  if (state.mode === 'focus') {
    if (countFocusCompletion) {
      state.completedCycles += 1
      state.settings.completedFocusSessions += 1
    }
    const isLongBreakTurn =
      state.completedCycles % state.settings.cyclesUntilLongBreak === 0
    return isLongBreakTurn ? 'longBreak' : 'shortBreak'
  }
  return 'focus'
}

function shouldAutoStart(nextMode) {
  if (nextMode === 'focus') {
    return state.settings.autoStartFocus
  }
  return state.settings.autoStartBreaks
}

function advanceMode(countFocusCompletion = true) {
  stopTimer()
  const nextMode = chooseNextMode(countFocusCompletion)
  applyMode(nextMode)

  const messages = {
    focus: '休憩が終わりました。次の集中セッションに入ります。',
    shortBreak: '1セット完了。短い休憩に切り替えます。',
    longBreak: '区切りです。長休憩に切り替えます。',
  }

  notifyModeSwitch(messages[nextMode])

  if (shouldAutoStart(nextMode)) {
    startTimer()
  }
}

function tick() {
  if (!state.isRunning || state.endTimeMs === null) return

  const remainingMs = Math.max(0, state.endTimeMs - performance.now())
  const preciseRemainingSeconds = remainingMs / 1000
  const wholeRemainingSeconds = Math.ceil(preciseRemainingSeconds)

  updateProgress(preciseRemainingSeconds)

  if (wholeRemainingSeconds !== state.remainingSeconds) {
    state.remainingSeconds = wholeRemainingSeconds
    render()

    if (
      state.settings.soundEnabled &&
      (wholeRemainingSeconds === 2 || wholeRemainingSeconds === 1) &&
      state.lastAnnouncedSecond !== wholeRemainingSeconds
    ) {
      state.lastAnnouncedSecond = wholeRemainingSeconds
      playCountdownChime()
    }
  }

  if (remainingMs === 0) {
    handleTimerCompletion()
    return
  }

  state.animationFrameId = requestAnimationFrame(tick)
}

function startTimer() {
  if (state.isRunning) return
  state.isRunning = true
  state.endTimeMs = performance.now() + state.remainingSeconds * 1000
  state.lastAnnouncedSecond = null
  elements.statusMessage.textContent = `${MODES[state.mode].label} を開始しました。`
  render()
  state.animationFrameId = requestAnimationFrame(tick)
}

function pauseTimer() {
  if (state.isRunning && state.endTimeMs !== null) {
    state.remainingSeconds = Math.max(0, Math.ceil((state.endTimeMs - performance.now()) / 1000))
  }
  stopTimer()
  elements.statusMessage.textContent = 'タイマーを一時停止しました。'
  render()
}

function resetCurrentMode() {
  stopTimer()
  applyMode(state.mode)
  elements.statusMessage.textContent = `${MODES[state.mode].label} をリセットしました。`
}

function readSettingsFromInputs() {
  const focus = readDurationInput(
    elements.inputs.focusMinutes.value,
    elements.inputs.focusSeconds.value,
    99,
    DEFAULTS.durations.focus,
  )
  const shortBreak = readDurationInput(
    elements.inputs.shortBreakMinutes.value,
    elements.inputs.shortBreakSeconds.value,
    59,
    DEFAULTS.durations.shortBreak,
  )
  const longBreak = readDurationInput(
    elements.inputs.longBreakMinutes.value,
    elements.inputs.longBreakSeconds.value,
    99,
    DEFAULTS.durations.longBreak,
  )
  const cyclesUntilLongBreak = clampNumber(
    elements.inputs.cyclesUntilLongBreak.value,
    2,
    8,
    DEFAULTS.cyclesUntilLongBreak,
  )

  return {
    durations: { focus, shortBreak, longBreak },
    cyclesUntilLongBreak,
    autoStartBreaks: elements.inputs.autoStartBreaks.checked,
    autoStartFocus: elements.inputs.autoStartFocus.checked,
    soundEnabled: elements.inputs.soundEnabled.checked,
    soundVolume: clampNumber(elements.inputs.soundVolume.value, 0, 100, DEFAULTS.soundVolume),
    durationUnit: 'seconds',
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function normalizeSavedPresets(savedPresets) {
  if (!Array.isArray(savedPresets)) return []
  return savedPresets
    .map((preset) => {
      const name = String(preset?.name ?? '').trim()
      if (!name) return null
      return {
        id: String(preset.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        name: name.slice(0, 24),
        durations: {
          focus: normalizeDurationValue(preset?.durations?.focus, DEFAULTS.durations.focus, true),
          shortBreak: normalizeDurationValue(
            preset?.durations?.shortBreak,
            DEFAULTS.durations.shortBreak,
            true,
          ),
          longBreak: normalizeDurationValue(
            preset?.durations?.longBreak,
            DEFAULTS.durations.longBreak,
            true,
          ),
        },
        cyclesUntilLongBreak: clampNumber(
          preset?.cyclesUntilLongBreak,
          2,
          8,
          DEFAULTS.cyclesUntilLongBreak,
        ),
      }
    })
    .filter(Boolean)
    .slice(0, MAX_SAVED_PRESETS)
}

function normalizeDurationValue(value, fallback, usesSecondUnit) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const seconds = usesSecondUnit ? parsed : parsed * 60
  return Math.max(1, Math.round(seconds))
}

function splitDuration(totalSeconds) {
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  }
}

function readDurationInput(minutesValue, secondsValue, maxMinutes, fallback) {
  const fallbackSplit = splitDuration(fallback)
  const minutes = clampNumber(minutesValue, 0, maxMinutes, fallbackSplit.minutes)
  const seconds = clampNumber(secondsValue, 0, 59, fallbackSplit.seconds)
  const totalSeconds = minutes * 60 + seconds
  return Math.max(1, totalSeconds)
}

function saveSettings() {
  const currentSnapshot = {
    mode: state.mode,
    remainingRatio:
      state.totalSeconds === 0 ? 1 : getCurrentRemainingSeconds() / state.totalSeconds,
  }

  state.settings = {
    ...normalizeSettings(state.settings),
    ...readSettingsFromInputs(),
  }

  state.totalSeconds = state.settings.durations[currentSnapshot.mode]
  state.remainingSeconds = Math.max(0, Math.round(state.totalSeconds * currentSnapshot.remainingRatio))

  syncInputs()
  render()
  saveState()
  elements.statusMessage.textContent = '設定を保存しました。現在のセッションにも比率を保って反映しました。'
}

function getCurrentRemainingSeconds() {
  if (!state.isRunning || state.endTimeMs === null) {
    return state.remainingSeconds
  }

  return Math.max(0, (state.endTimeMs - performance.now()) / 1000)
}

function bindEvents() {
  elements.startPauseButton.addEventListener('click', () => {
    if (state.isRunning) {
      pauseTimer()
    } else {
      startTimer()
    }
  })

  elements.resetButton.addEventListener('click', resetCurrentMode)
  elements.skipButton.addEventListener('click', () => {
    const countFocusCompletion = state.mode !== 'focus' || state.remainingSeconds === 0
    advanceMode(countFocusCompletion)
  })
  elements.openSettingsButton.addEventListener('click', openSettings)
  elements.closeSettingsButton.addEventListener('click', closeSettings)
  elements.settingsBackdrop.addEventListener('click', closeSettings)
  elements.saveSettingsButton.addEventListener('click', saveSettings)
  elements.savePresetButton.addEventListener('click', saveCurrentPreset)
  elements.inputs.soundVolume.addEventListener('input', () => {
    elements.soundVolumeValue.textContent = `${elements.inputs.soundVolume.value}%`
  })
  elements.presetList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return

    const loadButton = event.target.closest('[data-preset-load]')
    if (loadButton) {
      applySavedPreset(loadButton.dataset.presetLoad)
      return
    }

    const deleteButton = event.target.closest('[data-preset-delete]')
    if (deleteButton) {
      deleteSavedPreset(deleteButton.dataset.presetDelete)
    }
  })

  elements.modeTabs.forEach((button) => {
    button.addEventListener('click', () => {
      stopTimer()
      applyMode(button.dataset.mode)
      elements.statusMessage.textContent = `${MODES[state.mode].label} に切り替えました。`
    })
  })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.settingsModal.classList.contains('is-open')) {
      closeSettings()
    }
  })
}

function saveCurrentPreset() {
  const name = elements.presetName.value.trim()
  if (!name) {
    elements.statusMessage.textContent = 'プリセット名を入力してください。'
    return
  }

  const current = readSettingsFromInputs()
  const preset = {
    id: `preset-${Date.now()}`,
    name: name.slice(0, 24),
    durations: current.durations,
    cyclesUntilLongBreak: current.cyclesUntilLongBreak,
  }

  state.settings.savedPresets = [preset, ...state.settings.savedPresets.filter((item) => item.name !== preset.name)]
    .slice(0, MAX_SAVED_PRESETS)
  elements.presetName.value = ''
  renderPresetList()
  saveState()
  elements.statusMessage.textContent = `「${preset.name}」を保存しました。`
}

function applySavedPreset(presetId) {
  const preset = state.settings.savedPresets.find((item) => item.id === presetId)
  if (!preset) return

  const focus = splitDuration(preset.durations.focus)
  const shortBreak = splitDuration(preset.durations.shortBreak)
  const longBreak = splitDuration(preset.durations.longBreak)

  elements.inputs.focusMinutes.value = focus.minutes
  elements.inputs.focusSeconds.value = focus.seconds
  elements.inputs.shortBreakMinutes.value = shortBreak.minutes
  elements.inputs.shortBreakSeconds.value = shortBreak.seconds
  elements.inputs.longBreakMinutes.value = longBreak.minutes
  elements.inputs.longBreakSeconds.value = longBreak.seconds
  elements.inputs.cyclesUntilLongBreak.value = preset.cyclesUntilLongBreak
  elements.statusMessage.textContent = `「${preset.name}」を反映しました。保存で確定します。`
}

function deleteSavedPreset(presetId) {
  const preset = state.settings.savedPresets.find((item) => item.id === presetId)
  if (!preset) return

  state.settings.savedPresets = state.settings.savedPresets.filter((item) => item.id !== presetId)
  renderPresetList()
  saveState()
  elements.statusMessage.textContent = `「${preset.name}」を削除しました。`
}

function formatPresetSummary(preset) {
  return [
    formatTime(preset.durations.focus),
    formatTime(preset.durations.shortBreak),
    formatTime(preset.durations.longBreak),
    `${preset.cyclesUntilLongBreak}R`,
  ].join(' / ')
}

function escapeHtml(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return String(value).replace(/[&<>"']/g, (char) => replacements[char])
}

function init() {
  elements.progressRing.style.strokeDasharray = String(RING_LENGTH)
  loadState()
  syncInputs()
  render()
  bindEvents()
}

init()
