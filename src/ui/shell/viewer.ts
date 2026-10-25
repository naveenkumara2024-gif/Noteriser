/**
 * Who is looking at the shell. Until accounts exist (Stage 11) it is always `guest-no-auth`: there
 * is no sign-in, history is the runs this browser started, and the account card says so. Stage 11
 * adds `guest` and `user` here and changes where the layout gets the value; the components that
 * switch on it do not move.
 */
export type Viewer = { kind: "guest-no-auth" };
