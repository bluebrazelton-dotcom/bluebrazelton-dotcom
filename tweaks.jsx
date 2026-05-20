/* global React, ReactDOM, TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSelect */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "warm",
  "accent": "warmblue",
  "type": "editorial"
}/*EDITMODE-END*/;

function TweaksApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply tweaks to body data-attrs so CSS picks them up
  React.useEffect(() => {
    document.body.dataset.theme = tweaks.theme;
    document.body.dataset.accent = tweaks.accent;
    document.body.dataset.type = tweaks.type;
  }, [tweaks]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Background tone">
        <TweakRadio
          value={tweaks.theme}
          onChange={(v) => setTweak("theme", v)}
          options={[
            { value: "warm", label: "Warm" },
            { value: "cool", label: "Cool" },
            { value: "paper", label: "Paper" },
          ]}
        />
      </TweakSection>

      <TweakSection title="Accent">
        <TweakRadio
          value={tweaks.accent}
          onChange={(v) => setTweak("accent", v)}
          options={[
            { value: "warmblue", label: "Warm blue" },
            { value: "dusk", label: "Dusk" },
            { value: "oxblood", label: "Oxblood" },
            { value: "forest", label: "Forest" },
            { value: "none", label: "None" },
          ]}
        />
      </TweakSection>

      <TweakSection title="Typography">
        <TweakSelect
          value={tweaks.type}
          onChange={(v) => setTweak("type", v)}
          options={[
            { value: "editorial", label: "Source Serif + Inter" },
            { value: "literary",  label: "EB Garamond + Inter" },
            { value: "modern",    label: "Newsreader + Inter" },
          ]}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

const tweakRoot = document.createElement("div");
document.body.appendChild(tweakRoot);
ReactDOM.createRoot(tweakRoot).render(<TweaksApp />);
