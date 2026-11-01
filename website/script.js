// Penny site: a little life, nothing more. Parallax on the hero cards, scroll reveal, footer year.
(() => {
  const root = document.documentElement;
  root.classList.add("js");

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Footer year
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  // Close the phone menu after picking a link
  const menu = document.querySelector(".nav-menu");
  if (menu) {
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) menu.open = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  }

  // Scroll reveal
  const revealEls = document.querySelectorAll(".reveal");
  if (reduce.matches || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  // The pen and loop on the hero screen are SMIL animations: freeze them on a finished frame
  // when the visitor prefers less motion.
  const ink = document.querySelector(".screen-ink");
  const freezeInk = () => {
    if (ink && reduce.matches && typeof ink.pauseAnimations === "function") {
      ink.setCurrentTime(5.6);
      ink.pauseAnimations();
    } else if (ink && typeof ink.unpauseAnimations === "function") {
      ink.unpauseAnimations();
    }
  };
  freezeInk();
  reduce.addEventListener?.("change", freezeInk);

  // Gentle parallax of the floating cards and emoji (desktop pointers only)
  const hero = document.querySelector(".hero");
  const layers = Array.from(document.querySelectorAll(".hero [data-depth]"));
  const fine = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)");
  if (!hero || !layers.length) return;

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let frame = 0;

  const tick = () => {
    x += (targetX - x) * 0.08;
    y += (targetY - y) * 0.08;
    for (const el of layers) {
      const depth = Number(el.dataset.depth) || 0;
      el.style.setProperty("--px", `${(x * depth).toFixed(2)}px`);
      el.style.setProperty("--py", `${(y * depth).toFixed(2)}px`);
    }
    frame = Math.abs(targetX - x) > 0.001 || Math.abs(targetY - y) > 0.001 ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  hero.addEventListener("pointermove", (e) => {
    if (!fine.matches || reduce.matches) return;
    const r = hero.getBoundingClientRect();
    targetX = ((e.clientX - r.left) / r.width - 0.5) * 2;
    targetY = ((e.clientY - r.top) / Math.min(r.height, window.innerHeight) - 0.5) * 2;
    kick();
  });
  hero.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0;
    kick();
  });
})();
