"use client";

const AGENTS = [
  { key: "commercial",        label: "Commercial",         role: "Prospection & emails",    color: "#2563eb", light: "#eff6ff" },
  { key: "community_manager", label: "Community Manager",  role: "Instagram & Facebook",    color: "#db2777", light: "#fdf2f8" },
  { key: "developpeur",       label: "Développeur",        role: "Code & architecture",     color: "#059669", light: "#ecfdf5" },
  { key: "comptable",         label: "Comptable",          role: "Finances & facturation",  color: "#d97706", light: "#fffbeb" },
];

const CIO_X = 158;
const CIO_Y = 140;
const CIO_W = 124;
const CIO_H = 48;

const NODE_X = 368;
const NODE_W = 130;
const NODE_H = 40;
const NODE_GAP = 56;

const FIRST_Y = CIO_Y - ((AGENTS.length - 1) / 2) * NODE_GAP;

const DIR_X = 28;
const DIR_Y = CIO_Y;

export default function AgentMindMap() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Fonctionnement de l&apos;équipe agentique
      </p>
      <svg
        viewBox="0 0 530 280"
        className="w-full"
        style={{ maxHeight: 260 }}
        aria-label="Mind map de l'équipe agentique"
      >
        {/* ── Dirigeant ── */}
        <rect x={DIR_X} y={DIR_Y - 20} width={72} height={40} rx={8}
          fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5} />
        <text x={DIR_X + 36} y={DIR_Y - 4} textAnchor="middle" fontSize={10}
          fill="#475569" fontWeight="600">Dirigeant</text>
        <text x={DIR_X + 36} y={DIR_Y + 10} textAnchor="middle" fontSize={9}
          fill="#94a3b8">Élude In Art</text>

        {/* Arrow Dirigeant → CIO */}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#7c3aed" />
          </marker>
        </defs>
        <line
          x1={DIR_X + 72} y1={DIR_Y}
          x2={CIO_X - 2} y2={CIO_Y}
          stroke="#7c3aed" strokeWidth={1.5}
          markerEnd="url(#arrow)"
          strokeDasharray="4 3"
        />

        {/* ── CIO node ── */}
        <rect x={CIO_X} y={CIO_Y - CIO_H / 2} width={CIO_W} height={CIO_H} rx={10}
          fill="#7c3aed" />
        <text x={CIO_X + CIO_W / 2} y={CIO_Y - 6} textAnchor="middle" fontSize={11}
          fill="white" fontWeight="700">CIO</text>
        <text x={CIO_X + CIO_W / 2} y={CIO_Y + 9} textAnchor="middle" fontSize={9.5}
          fill="#ddd6fe">Orchestrateur</text>
        <text x={CIO_X + CIO_W / 2} y={CIO_Y + 22} textAnchor="middle" fontSize={8.5}
          fill="#c4b5fd">Stratégie & délégation</text>

        {/* ── Curved connectors CIO → agents ── */}
        {AGENTS.map((ag, i) => {
          const ty = FIRST_Y + i * NODE_GAP;
          const cx1 = CIO_X + CIO_W + 30;
          const cx2 = NODE_X - 20;
          return (
            <path
              key={ag.key}
              d={`M${CIO_X + CIO_W},${CIO_Y} C${cx1},${CIO_Y} ${cx2},${ty} ${NODE_X},${ty}`}
              fill="none"
              stroke={ag.color}
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
          );
        })}

        {/* ── Agent nodes ── */}
        {AGENTS.map((ag, i) => {
          const ty = FIRST_Y + i * NODE_GAP;
          return (
            <g key={ag.key}>
              <rect
                x={NODE_X} y={ty - NODE_H / 2}
                width={NODE_W} height={NODE_H}
                rx={8}
                fill={ag.light}
                stroke={ag.color}
                strokeWidth={1.5}
              />
              <text x={NODE_X + NODE_W / 2} y={ty - 4} textAnchor="middle"
                fontSize={10.5} fill={ag.color} fontWeight="700">
                {ag.label}
              </text>
              <text x={NODE_X + NODE_W / 2} y={ty + 10} textAnchor="middle"
                fontSize={9} fill="#64748b">
                {ag.role}
              </text>
            </g>
          );
        })}

        {/* ── Legend: délégation label ── */}
        <text x={CIO_X + CIO_W + 22} y={CIO_Y - 28} fontSize={8.5}
          fill="#7c3aed" fontStyle="italic">délégation</text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {AGENTS.map((ag) => (
          <div key={ag.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ag.color }} />
            <span className="text-[10px] text-slate-500">{ag.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
