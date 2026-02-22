"use client";

import { useState, useEffect } from "react";
import { getSunPosition } from "@/lib/sun";

export function useSunPosition() {
  const [sunPos, setSunPos] = useState(() => getSunPosition(new Date()));

  useEffect(() => {
    const update = () => setSunPos(getSunPosition(new Date()));
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  return sunPos;
}
