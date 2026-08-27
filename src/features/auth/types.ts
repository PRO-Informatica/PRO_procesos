export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fields?: {
    email?: string;
  };
};

export const initialAuthActionState: AuthActionState = {
  status: "idle",
};

export type SessionProfile = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  email: string;
};
