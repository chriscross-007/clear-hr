"use client";

import { createContext, useContext } from "react";

type MemberLabelContextType = {
  memberLabel: string;
};

const MemberLabelContext = createContext<MemberLabelContextType>({
  memberLabel: "member",
});

export function MemberLabelProvider({
  memberLabel,
  children,
}: {
  memberLabel: string;
  children: React.ReactNode;
}) {
  return (
    <MemberLabelContext.Provider value={{ memberLabel }}>
      {children}
    </MemberLabelContext.Provider>
  );
}

export function useMemberLabel() {
  return useContext(MemberLabelContext);
}
