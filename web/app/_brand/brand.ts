// Product brand. Change the name here and it changes everywhere.
export const BRAND = {
  name: "Resassistant",
  tagline: "The AI receptionist for restaurants",
  sessionCookie: "resassistant_session"
};

export function signOut() {
  document.cookie = `${BRAND.sessionCookie}=; path=/; max-age=0; samesite=lax`;
  window.location.href = "/";
}
