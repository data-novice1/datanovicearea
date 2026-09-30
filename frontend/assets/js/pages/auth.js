import { sb, boot, $, $$, h, qs, toast, notice, errorMessage, busy, safeRedirect, config } from '../lib.js';

const siteUrl = () => config.SITE_URL || location.origin;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

boot(async (profile) => {
  const redirect = safeRedirect(qs('redirect'));
  const tabs = { login: $('#form-login'), signup: $('#form-signup'), forgot: $('#form-forgot') };

  function show(name) {
    Object.entries(tabs).forEach(([k, form]) => { form.hidden = k !== name; });
    $$('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.id === `tab-${name}`)));
  }
  $('#tab-login').addEventListener('click', () => show('login'));
  $('#tab-signup').addEventListener('click', () => show('signup'));
  $('#tab-forgot').addEventListener('click', () => show('forgot'));
  if (qs('mode') === 'inscription') show('signup');

  const say = (msg, type) => $('#auth-notice').replaceChildren(notice(msg, type));

  // Lien "mot de passe oublié" : Supabase ouvre une session de récupération
  function showReset() {
    $('.tabs').hidden = true;
    Object.values(tabs).forEach((f) => (f.hidden = true));
    $('#form-reset').hidden = false;
  }
  sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') showReset(); });
  if (qs('mode') === 'reset' && profile) showReset();
  else if (profile && qs('mode') !== 'reset') return location.replace(redirect);

  tabs.login.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const { error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
      if (error) return say(errorMessage(error), 'err');
      location.replace(redirect);
    });
  });

  tabs.signup.addEventListener('submit', (e) => {
    e.preventDefault();
    const full_name = $('#s-name').value.trim();
    const email = $('#s-email').value.trim();
    const password = $('#s-pass').value;
    if (full_name.length < 2) return say('Indiquez votre prénom et votre nom.', 'err');
    if (!EMAIL_RE.test(email)) return say('Adresse e-mail invalide.', 'err');
    if (password.length < 10) return say('Mot de passe trop court : 10 caractères minimum.', 'err');
    if (!$('#s-terms').checked) return say('Acceptez les conditions pour créer votre compte.', 'err');
    busy(e.submitter, async () => {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name }, emailRedirectTo: `${siteUrl()}/connexion.html?redirect=${encodeURIComponent(redirect)}` },
      });
      if (error) return say(errorMessage(error), 'err');
      if (data.session) return location.replace(redirect);
      tabs.signup.reset();
      say(`Compte créé. Un e-mail de confirmation vient d'être envoyé à ${email} : cliquez sur le lien pour activer votre compte.`, 'ok');
      show('login');
    });
  });

  tabs.forgot.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#f-email').value.trim();
    if (!EMAIL_RE.test(email)) return say('Adresse e-mail invalide.', 'err');
    busy(e.submitter, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/connexion.html?mode=reset` });
      if (error) return say(errorMessage(error), 'err');
      say('Si un compte existe avec cet e-mail, un lien de réinitialisation vient d\'être envoyé.', 'ok');
    });
  });

  $('#form-reset').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = $('#r-pass').value;
    if (password.length < 10) return say('10 caractères minimum.', 'err');
    busy(e.submitter, async () => {
      const { error } = await sb.auth.updateUser({ password });
      if (error) return say(errorMessage(error), 'err');
      toast('Mot de passe modifié.', 'ok');
      location.replace('compte.html');
    });
  });
});
