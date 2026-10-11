import { useMemo, useEffect } from 'react'
import { RigidBody } from '@react-three/rapier'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { useDebugStore } from '../../store/debug'
import { ObjectRenderMode, WorldRenderMode } from '../../types/world'
import { useAssetMaterials } from '../scene/useAssetMaterials'
import { DROP_TARGET_LAYER } from '../scene/dropTargets'
import { shadowCatcherColor, shadowCatcherOpacity } from '../scene/shadows'

interface Props {
  url: string
  flipY?: boolean
  groundPlaneOffset?: number
  metricScaleFactor?: number
  shadowOpacity?: number
  shadowColor?: string
  renderMaterials?: boolean
}

const ignoreRaycast: THREE.Object3D['raycast'] = () => {}

export function WorldCollider({ url, flipY, groundPlaneOffset, metricScaleFactor, shadowOpacity, shadowColor, renderMaterials = false }: Props) {
  const { scene: rawScene } = useGLTF(url)
  const objectRenderMode = useDebugStore((s) => s.objectRenderMode)
  const worldRenderMode = useDebugStore((s) => s.worldRenderMode)
  const { wireframeMaterial, shadedMaterial, wireframeOverlayMaterial } = useAssetMaterials()
  const normalizedGroundPlaneOffset = groundPlaneOffset ?? 0
  const normalizedMetricScaleFactor = metricScaleFactor ?? 1
  const normalizedRotation = flipY ? Math.PI : 0
  const colliderTransformKey = `${url}:${normalizedRotation}:${normalizedGroundPlaneOffset}:${normalizedMetricScaleFactor}`

  // Own shadow material instance — not shared, so shader compiles correctly per-mesh
  const shadowMat = useMemo(() => new THREE.ShadowMaterial({
    color: shadowCatcherColor(shadowColor),
    opacity: shadowCatcherOpacity(shadowOpacity),
    transparent: true,
    depthWrite: false,
  }), [shadowColor, shadowOpacity])
  useEffect(() => () => shadowMat.dispose(), [shadowMat])

  useEffect(() => {
    shadowMat.color.set(shadowCatcherColor(shadowColor))
    shadowMat.opacity = shadowCatcherOpacity(shadowOpacity)
    shadowMat.needsUpdate = true
  }, [shadowColor, shadowMat, shadowOpacity])

  const { scene, overlayScene, dropTargetScene, originalMaterials } = useMemo(() => {
    const scene = cloneSkeleton(rawScene)
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) originalMaterials.set(child, child.material)
    })
    const dropTargetScene = cloneSkeleton(rawScene)
    dropTargetScene.traverse((child) => {
      child.layers.set(DROP_TARGET_LAYER)
    })
    return {
      scene,
      overlayScene: cloneSkeleton(rawScene),
      dropTargetScene,
      originalMaterials,
    }
  }, [rawScene])

  const showMesh = worldRenderMode !== WorldRenderMode.ObjectOnly

  useEffect(() => {
    const isLit = objectRenderMode === ObjectRenderMode.Lit
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.visible = showMesh
      child.raycast = ignoreRaycast
      child.receiveShadow = isLit
      child.material = isLit ? (renderMaterials ? originalMaterials.get(child)! : shadowMat)
        : objectRenderMode === ObjectRenderMode.ShadedWireframe ? shadedMaterial
        : wireframeMaterial
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => { material.needsUpdate = true })
    })
  }, [scene, showMesh, objectRenderMode, wireframeMaterial, shadedMaterial, shadowMat, renderMaterials, originalMaterials])

  useEffect(() => {
    overlayScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.material = wireframeOverlayMaterial
      child.renderOrder = 1
      child.raycast = ignoreRaycast
    })
  }, [overlayScene, wireframeOverlayMaterial])

  return (
    <>
      <RigidBody
        key={colliderTransformKey}
        type="fixed"
        colliders="trimesh"
        rotation={[normalizedRotation, 0, 0]}
        position={[0, normalizedGroundPlaneOffset, 0]}
        scale={[normalizedMetricScaleFactor, normalizedMetricScaleFactor, normalizedMetricScaleFactor]}
      >
        <primitive object={scene} />
        {objectRenderMode === ObjectRenderMode.ShadedWireframe && showMesh && (
          <primitive object={overlayScene} />
        )}
      </RigidBody>
      <primitive
        object={dropTargetScene}
        rotation={[normalizedRotation, 0, 0]}
        position={[0, normalizedGroundPlaneOffset, 0]}
        scale={[normalizedMetricScaleFactor, normalizedMetricScaleFactor, normalizedMetricScaleFactor]}
      />
    </>
  )
}
