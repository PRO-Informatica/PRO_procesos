"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthActionState } from "./types";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeNextPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = readText(formData, "email").toLowerCase();
  const password = readText(formData, "password");
  const next = safeNextPath(readText(formData, "next"));

  if (!isEmail(email) || !password) {
    return {
      status: "error",
      message: "Ingresa un correo válido y tu contraseña.",
      fields: { email },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return {
      status: "error",
      message: "El correo o la contraseña no son correctos.",
      fields: { email },
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile?.active) {
    await supabase.auth.signOut();
    return {
      status: "error",
      message:
        "Tu usuario no tiene acceso activo. Comunícate con el administrador de tu empresa.",
      fields: { email },
    };
  }

  redirect(next);
}

export async function requestPasswordReset(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = readText(formData, "email").toLowerCase();

  if (!isEmail(email)) {
    return {
      status: "error",
      message: "Ingresa un correo electrónico válido.",
      fields: { email },
    };
  }

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")}`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  return {
    status: "success",
    message:
      "Si el correo pertenece a una cuenta habilitada, recibirás instrucciones para restablecer tu contraseña.",
  };
}

export async function updatePassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = readText(formData, "password");
  const confirmation = readText(formData, "passwordConfirmation");

  if (password.length < 8) {
    return {
      status: "error",
      message: "La contraseña debe tener al menos 8 caracteres.",
    };
  }

  if (password !== confirmation) {
    return {
      status: "error",
      message: "Las contraseñas no coinciden.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims) {
    return {
      status: "error",
      message: "El enlace expiró. Solicita uno nuevo.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      status: "error",
      message: "No fue posible actualizar la contraseña. Solicita un enlace nuevo.",
    };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
