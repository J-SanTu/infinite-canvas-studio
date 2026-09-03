(() => {
    const shortcutLabels = {
        KeyQ: "选择",
        KeyW: "移动",
        KeyE: "旋转",
        KeyR: "缩放",
    };
    const viewShortcuts = new Set(["Numpad1", "Numpad3", "Numpad7", "Numpad9"]);

    function isEditableTarget(target) {
        return target instanceof HTMLElement && (target.matches("input, select, textarea") || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]')));
    }

    function shortcutCode(event) {
        if (shortcutLabels[event.code]) return event.code;
        const key = String(event.key || "").toLowerCase();
        return key && shortcutLabels[`Key${key.toUpperCase()}`] ? `Key${key.toUpperCase()}` : "";
    }

    function activateShortcut(code) {
        const label = shortcutLabels[code];
        if (!label) return false;
        const button = document.querySelector(`.viewport-toolbar button[aria-label="${label}"]`);
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
    }

    function forwardViewShortcut(code) {
        if (!viewShortcuts.has(code)) return false;
        const key = code.replace("Numpad", "");
        window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
        return true;
    }

    window.addEventListener(
        "keydown",
        (event) => {
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
            if (activateShortcut(shortcutCode(event))) event.preventDefault();
        },
        true,
    );

    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin || event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.source !== "santu-director-bridge" || data.type !== "shortcut") return;
        const code = String(data.code || "");
        activateShortcut(code) || forwardViewShortcut(code);
    });
})();
