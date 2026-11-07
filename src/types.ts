export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
}

export interface SignUpInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export interface SignInInput {
  /** Username or email */
  identifier: string;
  password: string;
}

export interface ProfileUpdateInput {
  username: string;
  email: string;
  displayName: string;
  /** Required only when changing the password */
  currentPassword?: string;
  newPassword?: string;
}
