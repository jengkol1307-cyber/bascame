"use client";

import dynamic from "next/dynamic";

export const TrackingMap = dynamic(
  () => import("./tracking-map").then((module) => module.TrackingMap),
  {
    ssr: false,
    loading: () => <div className="tracking-map-loading">Memuat peta pelacakan...</div>,
  },
);
