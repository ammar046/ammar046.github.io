(() => {
  const year = document.getElementById("y");
  if (year) year.textContent = String(new Date().getFullYear());

  // Reveal on scroll
  const els = Array.from(document.querySelectorAll(".reveal"));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "120px 0px -10% 0px", threshold: 0.01 }
  );
  els.forEach((el) => io.observe(el));

  // Gentle tilt effect on cards (mouse only)
  const card = document.querySelector(".tilt");
  if (card && matchMedia("(pointer:fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    card.addEventListener("mousemove", (ev) => {
      const r = card.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width;
      const py = (ev.clientY - r.top) / r.height;
      const rx = clamp((0.5 - py) * 8, -7, 7);
      const ry = clamp((px - 0.5) * 10, -9, 9);
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  }
})();

