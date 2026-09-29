import { useAllSettings } from '../../stores/settingsStore'
import { SettingRow } from './SettingsLayout'
import { playSound, unlockAudio } from '../../design/sound'
import './settings.css'

const ACCENTS = ['#e08a3c', '#d97b4f', '#c9a24b', '#7ba7bc', '#9c8ec9', '#7bc78a']
const CODE_FONTS = ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'Fira Code']

export default function CustomizePage() {
  const settings = useAllSettings()

  return (
    <div className="settings-page">
      <h1 className="settings-title">Customize</h1>
      <SettingRow label="Theme" hint="Dark is the default; light follows the same amber accent.">
        <div className="seg-group">
          {(['dark', 'light'] as const).map((theme) => (
            <button
              key={theme}
              className={`seg-option ${settings.theme === theme ? 'active' : ''}`}
              onClick={() => settings.update({ theme })}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Accent color" hint="Used for the bolt mark, buttons, and highlights.">
        <div className="swatch-row">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              aria-label={`Accent ${accent}`}
              className={`swatch ${settings.accent === accent ? 'active' : ''}`}
              style={{ background: accent }}
              onClick={() => settings.update({ accent })}
            />
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Density" hint="Compact tightens paddings across the workspace.">
        <div className="seg-group">
          {(['comfortable', 'compact'] as const).map((density) => (
            <button
              key={density}
              className={`seg-option ${settings.density === density ? 'active' : ''}`}
              onClick={() => settings.update({ density })}
            >
              {density === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label={`Interface font size — ${settings.fontSize}px`} hint="Applies to chat text and panels.">
        <input
          type="range"
          min={12}
          max={17}
          step={1}
          value={settings.fontSize}
          onChange={(event) => settings.update({ fontSize: Number(event.target.value) })}
          style={{ width: 180, accentColor: settings.accent }}
        />
      </SettingRow>

      <SettingRow label="Code font" hint="Used in the editor, terminal, and code blocks.">
        <select
          className="select-input"
          value={settings.codeFont}
          onChange={(event) => settings.update({ codeFont: event.target.value })}
        >
          {CODE_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Sound" hint="Short cues when you send, when a reply lands, and on error. Off by default.">
        <div className="seg-group">
          {([false, true] as const).map((on) => (
            <button
              key={String(on)}
              className={`seg-option ${settings.sound === on ? 'active' : ''}`}
              onClick={() => {
                settings.update({ sound: on })
                if (on) { unlockAudio(); playSound('success', true, settings.volume) }
              }}
            >
              {on ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </SettingRow>

      {settings.sound && (
        <SettingRow label="Volume" hint="Applies to every cue. Move the slider to preview.">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(event) => {
              const volume = Number(event.target.value)
              settings.update({ volume })
              playSound('reply', true, volume)
            }}
            style={{ width: 180, accentColor: settings.accent }}
          />
        </SettingRow>
      )}

      <p className="settings-note">Changes apply instantly and persist locally.</p>
    </div>
  )
}
