// =============================================================================
// NEXUS EXPLODE / UNFOLD SYSTEM — Holographic Exploded View
// Theorex NEXUS view — Three.js 0.158.0
// Globals: THREE, allNodes, nodeById, coreMats, nexusMode,
//          nucleusCoronas, graph3d
// =============================================================================

var nexusExplodeState = null; // null = collapsed, object = animating/exploded

// -----------------------------------------------------------------------------
// Easing
// -----------------------------------------------------------------------------

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// -----------------------------------------------------------------------------
// triggerNexusExplode
// -----------------------------------------------------------------------------

function triggerNexusExplode(graph3d, allNodes, nodeById, scene) {
  if (!nexusMode) return;

  // Toggle: collapse if already exploded/animating
  if (nexusExplodeState !== null) {
    collapseNexusExplode(graph3d);
    return;
  }

  // --- Build Class → Method children map ---
  var classChildren = new Map();
  allNodes
    .filter(function (n) { return n.type === 'Class'; })
    .forEach(function (cls) {
      var methods = allNodes.filter(function (m) {
        return m.module === cls.module &&
               m.type === 'Method' &&
               m.id !== cls.id;
      });
      classChildren.set(cls.id, methods);
    });

  // --- Store original positions for all nodes ---
  var origPositions = new Map(
    allNodes.map(function (n) {
      return [n.id, { x: n.x || 0, y: n.y || 0, z: n.z || 0 }];
    })
  );

  // --- Pin Class nodes at current position so the sim doesn't drift them ---
  allNodes
    .filter(function (n) { return n.type === 'Class'; })
    .forEach(function (n) {
      n.fx = n.x || 0;
      n.fy = n.y || 0;
      n.fz = n.z || 0;
    });

  // --- Initialise state ---
  nexusExplodeState = {
    phase: 1,
    startTime: Date.now(),
    classChildren: classChildren,
    origPositions: origPositions,
    tweens: []
  };

  // Animation loop will pick this up via animateNexusExplode()
}

// -----------------------------------------------------------------------------
// animateNexusExplode — call this every frame from your render loop
// -----------------------------------------------------------------------------

function animateNexusExplode() {
  if (!nexusExplodeState) return;

  var elapsed = Date.now() - nexusExplodeState.startTime;

  // Phase time parameters (ms)
  var t1 = Math.min(elapsed / 600, 1.0);                               // 0–600 ms
  var t2 = Math.min(Math.max((elapsed - 400) / 800,  0), 1.0);         // 400–1200 ms
  var t3 = Math.min(Math.max((elapsed - 800) / 1200, 0), 1.0);         // 800–2000 ms

  // -------------------------------------------------------------------------
  // Phase 1 — Nucleus corona spheres scale outward (supernova burst)
  // -------------------------------------------------------------------------
  if (nucleusCoronas && nucleusCoronas.length) {
    nucleusCoronas.forEach(function (c, i) {
      if (c && c.mesh) {
        c.mesh.scale.setScalar(1.0 + easeInOutCubic(t1) * (2 + i));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Class Method children unfold outward along Class→nucleus axis
  // -------------------------------------------------------------------------
  if (t2 > 0) {
    nexusExplodeState.classChildren.forEach(function (methods, classId) {
      var cls = nodeById.get(classId);
      if (!cls) return;

      // Direction from nucleus (origin) toward this class node
      var dir = new THREE.Vector3(
        cls.x || 0,
        cls.y || 0,
        cls.z || 0
      );
      var len = dir.length();
      if (len > 0) {
        dir.divideScalar(len); // normalise without allocating
      } else {
        dir.set(0, 1, 0);     // fallback: local Y
      }

      methods.forEach(function (m, i) {
        var orig = nexusExplodeState.origPositions.get(m.id);
        if (!orig) return;

        var distance = (30 + i * 15) * easeInOutCubic(t2);

        m.fx = orig.x + dir.x * distance;
        m.fy = orig.y + dir.y * distance;
        m.fz = orig.z + dir.z * distance;
      });
    });
  }

  // -------------------------------------------------------------------------
  // Phase 3 — Method node voxel shells increase emissive activity
  // -------------------------------------------------------------------------
  if (t3 > 0) {
    nexusExplodeState.classChildren.forEach(function (methods) {
      methods.forEach(function (m) {
        var core = coreMats.get(m.id);
        if (core) {
          core.emissiveIntensity = 0.75 + easeInOutCubic(t3) * 1.5;
        }
      });
    });
  }
}

// -----------------------------------------------------------------------------
// collapseNexusExplode — restore all nodes to original positions
// -----------------------------------------------------------------------------

function collapseNexusExplode(graph3dInstance) {
  if (!nexusExplodeState) return;

  var origPositions  = nexusExplodeState.origPositions;
  var classChildren  = nexusExplodeState.classChildren;

  // Restore Method node positions and release pins
  classChildren.forEach(function (methods) {
    methods.forEach(function (m) {
      var orig = origPositions.get(m.id);
      if (orig) {
        m.x = orig.x; m.y = orig.y; m.z = orig.z;
      }
      delete m.fx;
      delete m.fy;
      delete m.fz;
    });
  });

  // Unpin Class nodes
  allNodes
    .filter(function (n) { return n.type === 'Class'; })
    .forEach(function (n) {
      var orig = origPositions.get(n.id);
      if (orig) {
        n.x = orig.x; n.y = orig.y; n.z = orig.z;
      }
      delete n.fx;
      delete n.fy;
      delete n.fz;
    });

  // Reset corona scales to identity
  if (nucleusCoronas && nucleusCoronas.length) {
    nucleusCoronas.forEach(function (c) {
      if (c && c.mesh) {
        c.mesh.scale.setScalar(1.0);
      }
    });
  }

  // Reset method node emissive intensity
  classChildren.forEach(function (methods) {
    methods.forEach(function (m) {
      var core = coreMats.get(m.id);
      if (core) {
        core.emissiveIntensity = 0.75; // resting value
      }
    });
  });

  nexusExplodeState = null;

  // Let the force simulation re-settle
  var instance = graph3dInstance || graph3d;
  if (instance && typeof instance.d3ReheatSimulation === 'function') {
    instance.d3ReheatSimulation();
  }
}
