import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Flag, GitFork, GitMerge, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../api/client'
import type { Branch, GraphCheckpoint, GraphEdge, SpaceGraph } from '../../api/types'
import { cn } from '../../lib/cn'
import { layoutBranchGraph } from '../../lib/graphLayout'
import { plural } from '../../lib/format'
import { useUiStore } from '../../store/ui'
import { useWorkspaceStore } from '../../store/workspace'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

type BranchNodeData = {
  branch: Branch
  checkpoints: GraphCheckpoint[]
}

type BranchGraphNode = Node<BranchNodeData, 'branch'>

const edgeColors: Record<GraphEdge['kind'], string> = {
  fork: 'var(--color-muted)',
  merge: 'var(--color-accent)',
  sync: 'var(--color-success)',
}

function BranchNode({ data, selected }: NodeProps<BranchGraphNode>) {
  const active = useWorkspaceStore(
    (state) => state.currentBranchId === data.branch.id,
  )
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)
  const branch = data.branch
  const checkpoints = data.checkpoints

  const open = () => selectBranch(branch.id)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open branch ${branch.name}`}
      aria-current={active ? 'true' : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className={cn(
        'branch-graph-node w-[218px] rounded-xl border bg-surface px-3 py-2.5 text-left shadow-soft transition-all duration-150',
        active
          ? 'border-accent ring-2 ring-accent/20'
          : 'border-border hover:-translate-y-0.5 hover:border-muted/45 hover:shadow-float',
        selected && !active && 'border-muted/60',
        branch.archived && 'opacity-60',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-2 !border-surface !bg-muted/60"
      />
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full ring-[3px] ring-bg"
          style={{ backgroundColor: branch.color ?? 'var(--color-accent)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
          {branch.name}
        </span>
        {branch.is_root && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[8px] font-medium tracking-wide text-muted uppercase">
            root
          </span>
        )}
        {branch.archived && (
          <span className="text-[8px] font-medium text-warning">archived</span>
        )}
      </div>
      <p className="mt-1.5 text-[9px] text-muted">
        {plural(branch.message_count, 'message')} ·{' '}
        {plural(branch.memory_count, 'memory', 'memories')}
      </p>
      {checkpoints.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-[9px] font-medium text-accent-ink">
          <Flag size={9} aria-hidden />
          {checkpoints.length === 1
            ? checkpoints[0].name
            : `${checkpoints.length} checkpoints`}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-surface !bg-muted/60"
      />
    </div>
  )
}

const nodeTypes = { branch: BranchNode }

function edgeLabel(kind: GraphEdge['kind']): string {
  if (kind === 'merge') return 'merge up'
  return kind
}

function GraphCanvas({ graph }: { graph: SpaceGraph }) {
  const theme = useUiStore((state) => state.theme)
  const selectBranch = useWorkspaceStore((state) => state.selectBranch)

  const checkpointsByBranch = useMemo(() => {
    const map = new Map<string, GraphCheckpoint[]>()
    for (const checkpoint of graph.checkpoints) {
      const list = map.get(checkpoint.branch_id) ?? []
      list.push(checkpoint)
      map.set(checkpoint.branch_id, list)
    }
    return map
  }, [graph.checkpoints])

  const nodes = useMemo<BranchGraphNode[]>(() => {
    const positions = layoutBranchGraph(graph.branches)
    return graph.branches.map((branch) => ({
      id: branch.id,
      type: 'branch',
      position: positions.get(branch.id) ?? { x: 0, y: 0 },
      data: {
        branch,
        checkpoints: checkpointsByBranch.get(branch.id) ?? [],
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }))
  }, [checkpointsByBranch, graph.branches])

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const color = edgeColors[edge.kind]
        return {
          id: edge.id,
          source: edge.source_branch_id,
          target: edge.target_branch_id,
          type: 'smoothstep',
          label: edgeLabel(edge.kind),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color,
          },
          style: { stroke: color, strokeWidth: 1.5, strokeDasharray: edge.kind === 'fork' ? undefined : '4 3' },
          labelStyle: { fill: color, fontSize: 8, fontWeight: 600 },
          labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.92 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
        }
      }),
    [graph.edges],
  )

  return (
    <div className="branch-graph h-[360px] overflow-hidden rounded-xl border border-border bg-subtle/35">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme === 'system' ? 'system' : theme}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.3}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_event, node) => selectBranch(node.id)}
        aria-label="Interactive branch graph"
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}

export function BranchGraph({ spaceId }: { spaceId: string }) {
  const [graph, setGraph] = useState<SpaceGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const branchRevision = useWorkspaceStore((state) =>
    state.branches
      .map(
        (branch) =>
          `${branch.id}:${branch.head_commit_id}:${branch.message_count}:${branch.memory_count}:${branch.archived}`,
      )
      .join('|'),
  )

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<SpaceGraph>(`/spaces/${spaceId}/graph`, controller.signal)
      .then((result) => {
        setGraph(result)
        setLoading(false)
        setError(null)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught))
        setLoading(false)
      })
    return () => controller.abort()
  }, [spaceId, reloadKey, branchRevision])

  const retry = () => {
    setLoading(true)
    setError(null)
    setReloadKey((value) => value + 1)
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2 px-1">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
            <GitFork size={12} className="text-accent" aria-hidden />
            Branch graph
          </p>
          <p className="mt-0.5 text-[10px] text-muted">
            {graph
              ? `${plural(graph.branches.length, 'branch', 'branches')} · ${plural(graph.edges.length, 'connection')}`
              : 'Paths, merges, syncs and checkpoints'}
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          aria-label="Refresh branch graph"
          title="Refresh branch graph"
          className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </div>

      {loading && !graph ? (
        <div className="grid h-[300px] place-items-center rounded-xl border border-border bg-subtle/35 text-muted">
          <div className="flex items-center gap-2 text-[11px]">
            <Spinner className="size-4" />
            Mapping branches…
          </div>
        </div>
      ) : error && !graph ? (
        <div className="rounded-xl border border-border bg-subtle/35 px-4 py-10 text-center">
          <p className="text-[11px] text-danger">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={retry}
            leadingIcon={<RefreshCw size={12} aria-hidden />}
          >
            Try again
          </Button>
        </div>
      ) : graph ? (
        <>
          {error && (
            <p className="mb-2 rounded-lg bg-warning-soft px-2.5 py-2 text-[10px] text-warning">
              Showing the last graph. {error}
            </p>
          )}
          <GraphCanvas graph={graph} />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[9px] text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-px w-4 bg-muted" aria-hidden />
              fork
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-px w-4 border-t border-dashed border-accent" aria-hidden />
              merge up
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-px w-4 border-t border-dashed border-success" aria-hidden />
              sync
            </span>
            <span className="inline-flex items-center gap-1">
              <Flag size={9} className="text-accent" aria-hidden />
              checkpoint
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-subtle px-2.5 py-2 text-[10px] leading-relaxed text-muted">
            <GitMerge size={12} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            Click a branch to open it. Arrows show inheritance, merges upward, and synced
            memories.
          </div>
        </>
      ) : null}
    </div>
  )
}
