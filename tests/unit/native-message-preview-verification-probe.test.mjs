import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../android/app/src/androidTest/java/com/kub/messenger/NativeMessagePreviewVerificationTest.java', import.meta.url), 'utf8');

// Execute the actual Java string literals, not a separately maintained submit implementation.
function javaConcat(expression, constants = {}) {
  const token = /\s*("(?:[^"\\]|\\.)*"|FORM_HELPERS|\+)\s*/y;
  let position = 0, result = '', expectValue = true;
  while (position < expression.length) {
    token.lastIndex = position;
    const part = token.exec(expression);
    assert.ok(part, 'The selected Java expression must remain a bounded literal concatenation');
    const value = part[1];
    assert.equal(value === '+', !expectValue, 'Java literal concatenation must preserve its grammar');
    if (expectValue) result += value.startsWith('"') ? JSON.parse(value) : constants[value];
    expectValue = !expectValue;
    position = token.lastIndex;
  }
  assert.equal(expectValue, false);
  return result;
}

const helpers = javaConcat(source.match(/private static final String FORM_HELPERS\s*=\s*([\s\S]*?);\s*\n/)[1]);
const submit = javaConcat(source.match(/boolean submitted = evaluateBoolean\(activity,\s*([\s\S]*?),\s*deadline\);/)[1], { FORM_HELPERS: helpers });

function fixture(options = {}) {
  const stats = { clicks: 0, validations: 0 };
  const element = () => ({ getClientRects: () => [{}], disabled: false, readOnly: false });
  const email = element(), password = element(), button = element();
  button.getAttribute = () => options.ariaDisabled ? 'true' : null;
  button.click = () => { ++stats.clicks; };
  Object.assign(email, options.email);
  Object.assign(password, options.password);
  Object.assign(button, options.button);
  const list = (value, count = 1) => Array.from({ length: count }, () => value);
  const form = {
    ...element(),
    checkValidity: () => { ++stats.validations; return options.valid !== false; },
    querySelectorAll: selector => selector === 'input[type=email]' ? list(email, options.emailCount)
      : selector === 'input[type=password][autocomplete=current-password]' ? list(password, options.passwordCount)
        : selector === 'button[type=submit]' ? list(button, options.buttonCount) : [],
  };
  const shell = { ...element(), querySelectorAll: () => list(form, options.formCount) };
  return {
    stats,
    context: {
      document: {
        querySelectorAll: selector => selector === '[data-testid=auth-form-shell]' ? list(shell, options.shellCount) : [],
        querySelector: selectors => options.captcha && selectors.split(',').includes(options.captcha) ? element() : null,
      },
      getComputedStyle: value => ({ visibility: options.hidden === value ? 'hidden' : 'visible' }),
    },
  };
}

function refuse(script, options) {
  const dom = fixture(options);
  assert.equal(runInNewContext(script, dom.context), false);
  assert.equal(dom.stats.clicks, 0);
}

test('actual submit literal uses enabled rendered form validation and one click', () => {
  const dom = fixture();
  assert.equal(runInNewContext(submit, dom.context), true);
  assert.deepEqual(dom.stats, { clicks: 1, validations: 1 });
});

test('disabled and read-only controls cannot be forced by the actual submit literal', () => {
  for (const options of [
    { email: { disabled: true } }, { email: { readOnly: true } },
    { password: { disabled: true } }, { password: { readOnly: true } },
    { button: { disabled: true } }, { ariaDisabled: true },
  ]) refuse(submit, options);
});

test('invalid normal form is not submitted', () => refuse(submit, { valid: false }));

test('captcha container and provider controls prohibit submission without bypass', () => {
  for (const captcha of ['[data-testid=auth-captcha]', '[data-sitekey]', 'iframe[src*=captcha]', 'iframe[src*=turnstile]', 'input[name*=captcha]']) {
    refuse(submit, { captcha });
  }
});

test('missing or ambiguous login controls and reset form do not cause submission', () => {
  for (const options of [
    { shellCount: 0 }, { shellCount: 2 }, { formCount: 2 }, { emailCount: 2 },
    { passwordCount: 0 }, { passwordCount: 2 }, { buttonCount: 2 },
    { button: { getClientRects: () => [] } },
  ]) refuse(submit, options);
});

test('executed literal disabled-submit omission is detected by the refusal control', () => {
  assert.equal(submit.split('||submit.disabled').length, 2);
  const omission = submit.replace('||submit.disabled', '');
  assert.throws(() => refuse(omission, { button: { disabled: true } }), assert.AssertionError);
});
