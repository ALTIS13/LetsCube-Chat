export function readSendSmsDestination(user) {
  if (!user || typeof user !== "object") return null;

  if (Object.hasOwn(user, "new_phone")) {
    return readE164(user.new_phone);
  }
  return readE164(user.phone);
}

function readE164(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\+[1-9]\d{7,14}$/u.test(text) ? text : null;
}
