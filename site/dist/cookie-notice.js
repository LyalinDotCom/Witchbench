/* CookieConsent v3 is MIT licensed; the component is vendored with its license. */
CookieConsent.run({
  cookie: { name: 'witchbench_notice', expiresAfterDays: 182, useLocalStorage: true },
  disablePageInteraction: false,
  hideFromBots: false,
  guiOptions: {
    consentModal: { layout: 'box inline', position: 'bottom right', equalWeightButtons: true },
    preferencesModal: { layout: 'box' }
  },
  categories: { necessary: { enabled: true, readOnly: true } },
  language: {
    default: 'en',
    translations: {
      en: {
        consentModal: {
          description: 'No tracking cookies. We only remember this notice. <a href="privacy.html">Privacy</a>',
          acceptAllBtn: 'Got it',
          showPreferencesBtn: 'Details'
        },
        preferencesModal: {
          title: 'Storage preferences',
          savePreferencesBtn: 'Done',
          closeIconLabel: 'Close preferences',
          sections: [
            { description: 'Witchbench runs locally in your browser. We use no analytics, advertising, or tracking cookies.' },
            { title: 'Notice preference', description: 'A localStorage entry named witchbench_notice remembers your acknowledgement for 182 days. Search and graph selections stay in memory and reset when you reload.', linkedCategory: 'necessary' }
          ]
        }
      }
    }
  }
});
document.querySelectorAll('[data-cookie-settings]').forEach(button => {
  button.addEventListener('click', () => CookieConsent.showPreferences());
});
