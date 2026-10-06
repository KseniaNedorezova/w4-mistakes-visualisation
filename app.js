const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

const DL = [
  '#4DA2F1','#FF3D64','#8AD554','#FFC636','#6B57D2',
  '#FF7E00','#5DCFCE','#E861CE','#02B8A3','#FF4E82',
  '#8FDB8F','#FFB946','#A98FDB','#FF9655','#68B3FF',
  '#E8D85C','#99E099','#FF8FB5','#B5AAE0','#E8AE00'
];

const DL_SOFT = [
  '#7DBDF5','#FF7A93','#A8E07A','#FFD76B','#8E7DDC',
  '#FFA24D','#7EDBD9','#EE8DD8','#4DCFBC','#FF7EA0',
  '#A8E5A8','#FFCB6B','#BDA8E5','#FFB07A','#8DC8FF',
  '#EFE07A','#B0E8B0','#FFACC8','#C8BFE8','#F0C540'
];

const CAT_ABBR = {};

function fmtNum(n) { return n.toLocaleString('ru-RU'); }
function fmtK(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : fmtNum(n); }
function shortMonth(m) {
  const [y, mo] = m.split('-');
  const names = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return names[+mo - 1] + ' ' + y.slice(2);
}

let hoverTip = null;
function ensureTooltip() {
  if (hoverTip) return hoverTip;
  hoverTip = document.createElement('div');
  hoverTip.className = 'd3-tooltip';
  hoverTip.style.opacity = '0';
  document.body.appendChild(hoverTip);
  return hoverTip;
}
function showTip(evt, html) {
  const tip = ensureTooltip();
  tip.innerHTML = html;
  tip.style.opacity = '1';
  const x = Math.min(evt.clientX + 14, window.innerWidth - 260);
  const y = Math.max(evt.clientY - 10, 10);
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() {
  const tip = ensureTooltip();
  tip.style.opacity = '0';
}

createApp({
  setup() {
    const raw = ref(null);
    const selectedCategory = ref('');
    const tooltipItem = ref(null);

    onMounted(async () => {
      const r = await fetch('data.json');
      raw.value = await r.json();
      await nextTick();
      drawAll();
    });

    const allCategories = computed(() => {
      if (!raw.value) return [];
      return raw.value.categories.map(c => c['Категория']).sort();
    });

    const categoryList = computed(() => {
      if (!raw.value) return [];
      return raw.value.categories
        .map(c => ({
          name: c['Категория'],
          order_count: c.order_count,
          unique_items: c.unique_items,
          total_spend: c.total_spend,
          total_qty: c.total_qty,
          avg_discount: c.avg_discount
        }))
        .sort((a, b) => b.total_spend - a.total_spend);
    });

    const filteredItems = computed(() => {
      if (!raw.value) return [];
      let items = raw.value.items;
      if (selectedCategory.value) {
        items = items.filter(i => i.category === selectedCategory.value);
      }
      return items;
    });

    const filteredMonthly = computed(() => {
      if (!raw.value) return [];
      if (selectedCategory.value && raw.value.monthlyByCategory) {
        const catData = raw.value.monthlyByCategory[selectedCategory.value];
        if (catData) return catData.slice(-24);
      }
      return raw.value.monthly.slice(-24);
    });

    const currentMetrics = computed(() => {
      if (!raw.value) return { orders: 0, spend: 0, avgDiscount: 0 };
      if (!selectedCategory.value) {
        return {
          orders: raw.value.summary.totalOrders,
          spend: raw.value.summary.totalSpend,
          avgDiscount: raw.value.summary.avgDiscount
        };
      }
      const cat = raw.value.categories.find(c => c['Категория'] === selectedCategory.value);
      return {
        orders: cat ? cat.order_count : 0,
        spend: cat ? cat.total_spend : 0,
        avgDiscount: cat ? cat.avg_discount : 0
      };
    });

    const lastMonth = computed(() => {
      const data = filteredMonthly.value;
      if (!data.length) return { orders: 0, spend: 0, avg_discount: 0 };
      return data[data.length - 1];
    });

    const topItemsWithImages = computed(() => {
      return filteredItems.value
        .filter(i => i.image)
        .sort((a, b) => b.total_spend - a.total_spend)
        .slice(0, 24);
    });

    function drawAll() {
      if (!raw.value) return;
      drawSparklines();
      drawTimeline();
      drawCategoryBars();
      drawItemsCombined();
    }

    watch(selectedCategory, () => {
      nextTick(() => drawAll());
    });

    /* ---- Sparklines ---- */
    function drawSparklines() {
      const data = filteredMonthly.value;
      if (!data.length) return;
      drawSparkline('#spark-orders', data.map(d => d.orders), DL[1]);
      drawSparkline('#spark-spend', data.map(d => d.spend), DL[0]);
      drawSparkline('#spark-discount', data.map(d => d.avg_discount), DL[2]);
    }

    function drawSparkline(sel, vals, color) {
      const el = document.querySelector(sel);
      if (!el) return;
      const svg = d3.select(el);
      svg.selectAll('*').remove();
      const w = el.parentElement.offsetWidth || 200;
      const h = 40;
      svg.attr('width', w).attr('height', h);
      const x = d3.scaleLinear().domain([0, vals.length - 1]).range([4, w - 4]);
      const y = d3.scaleLinear().domain([0, d3.max(vals) || 1]).range([h - 4, 4]);

      const area = d3.area()
        .x((_, i) => x(i)).y0(h).y1(d => y(d)).curve(d3.curveMonotoneX);
      svg.append('path').datum(vals).attr('d', area).attr('fill', color).attr('opacity', .1);

      const line = d3.line()
        .x((_, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX);
      svg.append('path').datum(vals).attr('d', line)
        .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5);
    }

    /* ---- Timeline chart ---- */
    function drawTimeline() {
      const data = filteredMonthly.value;
      if (!data.length) return;
      const el = document.getElementById('timeline-chart');
      if (!el) return;
      const svg = d3.select(el);
      svg.selectAll('*').remove();

      const margin = { top: 12, right: 52, bottom: 40, left: 48 };
      const W = Math.max(el.parentElement.offsetWidth, 500);
      const H = 340;
      svg.attr('width', W).attr('height', H);

      const x = d3.scaleBand()
        .domain(data.map(d => d.month))
        .range([margin.left, W - margin.right])
        .padding(0.05);

      const ySpend = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.spend) * 1.1 || 1])
        .range([H - margin.bottom, margin.top]);

      const yOrders = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.orders) * 1.3 || 1])
        .range([H - margin.bottom, margin.top]);

      svg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(yOrders).ticks(5).tickSize(-(W - margin.left - margin.right)).tickFormat(''))
        .selectAll('line').attr('stroke', '#f0f0f0');
      svg.selectAll('.domain').remove();

      svg.selectAll('.bar-spend').data(data).enter().append('rect')
        .attr('x', d => x(d.month))
        .attr('y', d => ySpend(d.spend))
        .attr('width', x.bandwidth())
        .attr('height', d => H - margin.bottom - ySpend(d.spend))
        .attr('rx', 2)
        .attr('fill', DL[0])
        .attr('opacity', 0.8)
        .on('mouseenter', function (evt, d) {
          d3.select(this).attr('opacity', 1);
          showTip(evt,
            `<div class="tt-title">${shortMonth(d.month)}</div>` +
            `<div class="tt-row"><span class="tt-label">Траты</span><span class="tt-val">${fmtNum(d.spend)} ₽</span></div>` +
            `<div class="tt-row"><span class="tt-label">Заказы</span><span class="tt-val">${d.orders}</span></div>` +
            `<div class="tt-row"><span class="tt-label">Ср. скидка</span><span class="tt-val">${d.avg_discount}%</span></div>`
          );
        })
        .on('mousemove', function (evt) {
          showTip(evt, ensureTooltip().innerHTML);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('opacity', 0.8);
          hideTip();
        });

      const lineFn = d3.line()
        .x(d => x(d.month) + x.bandwidth() / 2)
        .y(d => yOrders(d.orders))
        .curve(d3.curveMonotoneX);
      svg.append('path').datum(data).attr('d', lineFn)
        .attr('fill', 'none').attr('stroke', DL[1]).attr('stroke-width', 2);

      svg.selectAll('.dot-orders').data(data).enter().append('circle')
        .attr('cx', d => x(d.month) + x.bandwidth() / 2)
        .attr('cy', d => yOrders(d.orders))
        .attr('r', 3).attr('fill', DL[1])
        .on('mouseenter', function (evt, d) {
          d3.select(this).attr('r', 5);
          showTip(evt,
            `<div class="tt-title">${shortMonth(d.month)}</div>` +
            `<div class="tt-row"><span class="tt-label">Заказы</span><span class="tt-val">${d.orders}</span></div>` +
            `<div class="tt-row"><span class="tt-label">Траты</span><span class="tt-val">${fmtNum(d.spend)} ₽</span></div>`
          );
        })
        .on('mousemove', function (evt) {
          showTip(evt, ensureTooltip().innerHTML);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('r', 3);
          hideTip();
        });

      svg.append('g')
        .attr('transform', `translate(0,${H - margin.bottom})`)
        .call(d3.axisBottom(x).tickSize(0).tickFormat(shortMonth))
        .selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end')
        .style('font-size', '10px')
        .style('fill', '#999');

      const leftAxis = svg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(yOrders).ticks(5).tickFormat(d3.format('.0f')));
      leftAxis.selectAll('text').style('font-size', '10px').style('fill', DL[1]);
      leftAxis.select('.domain').remove();

      const rightAxis = svg.append('g')
        .attr('transform', `translate(${W - margin.right},0)`)
        .call(d3.axisRight(ySpend).ticks(5).tickFormat(d => d >= 1000 ? (d / 1000) + 'K' : d));
      rightAxis.selectAll('text').style('font-size', '10px').style('fill', DL[0]);
      rightAxis.select('.domain').remove();

      svg.append('text')
        .attr('x', margin.left - 8).attr('y', margin.top - 6)
        .attr('text-anchor', 'end').attr('font-size', '10px').attr('fill', DL[1])
        .text('заказы');
      svg.append('text')
        .attr('x', W - margin.right + 8).attr('y', margin.top - 6)
        .attr('text-anchor', 'start').attr('font-size', '10px').attr('fill', DL[0])
        .text('₽');
    }

    /* ---- Category horizontal bars ---- */
    function drawCategoryBars() {
      const cats = categoryList.value;
      if (!cats.length) return;
      const el = document.getElementById('category-bar-chart');
      if (!el) return;
      const svg = d3.select(el);
      svg.selectAll('*').remove();

      const W = Math.max(el.parentElement.offsetWidth, 280);
      const margin = { top: 0, right: 4, bottom: 0, left: 0 };
      const targetH = 320;
      const gap = 6;
      const totalGapH = (cats.length - 1) * gap;
      const barH = Math.max(Math.floor((targetH - totalGapH) / cats.length), 22);
      const H = cats.length * (barH + gap) - gap;
      svg.attr('width', W).attr('height', H);

      const maxSpend = d3.max(cats, d => d.total_spend) || 1;
      const barMaxW = W - margin.left - margin.right;
      const xScale = d3.scaleLinear().domain([0, maxSpend]).range([0, barMaxW]);

      cats.forEach((cat, i) => {
        const y = margin.top + i * (barH + gap);
        const g = svg.append('g').attr('transform', `translate(0,${y})`);
        const colorIdx = allCategories.value.indexOf(cat.name) % DL_SOFT.length;
        const isActive = selectedCategory.value === cat.name;
        const barW = Math.max(xScale(cat.total_spend), 4);
        const label = CAT_ABBR[cat.name] || cat.name;

        // Full-width background
        g.append('rect')
          .attr('x', margin.left).attr('y', 0)
          .attr('width', barMaxW)
          .attr('height', barH)
          .attr('rx', 5)
          .attr('fill', '#f3f4f6')
          .style('cursor', 'pointer');

        // Value bar
        g.append('rect')
          .attr('x', margin.left).attr('y', 0)
          .attr('width', barW)
          .attr('height', barH)
          .attr('rx', 5)
          .attr('fill', isActive ? DL[colorIdx] : DL_SOFT[colorIdx]);

        // Clickable overlay
        g.append('rect')
          .attr('x', margin.left).attr('y', 0)
          .attr('width', barMaxW)
          .attr('height', barH)
          .attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('mouseenter', function (evt) {
            g.select('rect:nth-child(2)').attr('fill', DL[colorIdx]);
            showTip(evt,
              `<div class="tt-title">${cat.name}</div>` +
              `<div class="tt-row"><span class="tt-label">Сумма</span><span class="tt-val">${fmtNum(cat.total_spend)} ₽</span></div>` +
              `<div class="tt-row"><span class="tt-label">Заказы</span><span class="tt-val">${cat.order_count}</span></div>` +
              `<div class="tt-row"><span class="tt-label">Позиции</span><span class="tt-val">${cat.unique_items}</span></div>` +
              `<div class="tt-row"><span class="tt-label">Ср. скидка</span><span class="tt-val">${cat.avg_discount}%</span></div>`
            );
          })
          .on('mousemove', function (evt) {
            showTip(evt, ensureTooltip().innerHTML);
          })
          .on('mouseleave', function () {
            g.select('rect:nth-child(2)').attr('fill', isActive ? DL[colorIdx] : DL_SOFT[colorIdx]);
            hideTip();
          })
          .on('click', () => {
            selectedCategory.value = selectedCategory.value === cat.name ? '' : cat.name;
          });

        // Label on the left
        g.append('text')
          .attr('x', 10).attr('y', barH / 2 + 1)
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '11px')
          .attr('font-weight', isActive ? '700' : '600')
          .attr('fill', '#333')
          .text(label)
          .style('pointer-events', 'none');

        // Value on the right
        g.append('text')
          .attr('x', barMaxW - 6).attr('y', barH / 2 + 1)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '11px').attr('font-weight', '700')
          .attr('fill', '#666')
          .text(fmtK(cat.total_spend) + ' ₽')
          .style('pointer-events', 'none');
      });
    }

    /* ---- Combined items chart + gallery ---- */
    const COLOR_QTY = '#6B57D2';
    const COLOR_SPEND = '#02B8A3';

    function drawItemsCombined() {
      const items = filteredItems.value.sort((a, b) => b.total_spend - a.total_spend).slice(0, 20);
      const el = document.getElementById('items-combined');
      if (!el) return;
      el.innerHTML = '';
      if (!items.length) {
        el.innerHTML = '<div style="text-align:center;color:#999;padding:20px">Нет данных</div>';
        return;
      }

      const maxQty = d3.max(items, d => d.total_qty) || 1;
      const maxSpend = d3.max(items, d => d.total_spend) || 1;

      items.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'items-row';
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .12s';
        row.addEventListener('mouseenter', () => { row.style.background = '#f9fafb'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', () => openTooltip(item));

        const rank = document.createElement('div');
        rank.style.cssText = 'width:24px;text-align:center;font-size:13px;font-weight:700;color:#bbb;flex-shrink:0';
        rank.textContent = i + 1;
        row.appendChild(rank);

        const img = document.createElement('img');
        img.src = item.image ? 'items/' + item.image : '';
        img.style.cssText = 'width:44px;height:44px;object-fit:contain;border-radius:8px;background:#f9fafb;flex-shrink:0';
        img.onerror = function () { this.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23f0f0f0' width='100' height='100'/></svg>"; };
        row.appendChild(img);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';

        const name = document.createElement('div');
        name.style.cssText = 'font-size:13px;font-weight:600;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px';
        name.textContent = item['Название позиции'];
        info.appendChild(name);

        const qtyPct = Math.max((item.total_qty / maxQty) * 100, 1);
        const spendPct = Math.max((item.total_spend / maxSpend) * 100, 1);

        const qtyBar = document.createElement('div');
        qtyBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:3px';
        qtyBar.innerHTML =
          `<div style="flex:1;height:14px;background:#f3f4f6;border-radius:4px;overflow:hidden">` +
            `<div style="width:${qtyPct}%;height:100%;background:${COLOR_QTY};border-radius:4px;opacity:0.7"></div>` +
          `</div>` +
          `<span style="font-size:11px;font-weight:600;color:${COLOR_QTY};white-space:nowrap;min-width:55px;text-align:right">${item.total_qty} шт</span>`;
        info.appendChild(qtyBar);

        const spendBar = document.createElement('div');
        spendBar.style.cssText = 'display:flex;align-items:center;gap:8px';
        spendBar.innerHTML =
          `<div style="flex:1;height:14px;background:#f3f4f6;border-radius:4px;overflow:hidden">` +
            `<div style="width:${spendPct}%;height:100%;background:${COLOR_SPEND};border-radius:4px;opacity:0.7"></div>` +
          `</div>` +
          `<span style="font-size:11px;font-weight:600;color:${COLOR_SPEND};white-space:nowrap;min-width:55px;text-align:right">${fmtNum(item.total_spend)} ₽</span>`;
        info.appendChild(spendBar);

        row.appendChild(info);
        el.appendChild(row);
      });
    }

    /* ---- Tooltip modal ---- */
    function openTooltip(item) {
      const ph = raw.value.priceHistory[item['Название позиции']] || [];
      tooltipItem.value = { ...item, priceHist: ph };
      nextTick(() => drawPriceHistory(ph));
    }

    function drawPriceHistory(ph) {
      if (ph.length < 2) return;
      const el = document.getElementById('price-history-chart');
      if (!el) return;
      const svg = d3.select(el);
      svg.selectAll('*').remove();
      const W = el.parentElement.offsetWidth;
      const H = 80;
      svg.attr('width', W).attr('height', H);
      const margin = { top: 8, right: 8, bottom: 18, left: 34 };

      const x = d3.scalePoint().domain(ph.map(d => d.m)).range([margin.left, W - margin.right]).padding(.3);
      const y = d3.scaleLinear()
        .domain([d3.min(ph, d => d.p) * .9, d3.max(ph, d => d.p) * 1.1])
        .range([H - margin.bottom, margin.top]);

      svg.append('g').attr('transform', `translate(0,${H - margin.bottom})`)
        .call(d3.axisBottom(x).tickSize(0)
          .tickValues(ph.filter((_, i) => i % Math.ceil(ph.length / 6) === 0).map(d => d.m)))
        .selectAll('text').style('font-size', '9px').style('fill', '#999');

      svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(3).tickFormat(d => d + '₽'))
        .selectAll('text').style('font-size', '9px').style('fill', '#999');

      svg.selectAll('.domain').remove();

      const area = d3.area().x(d => x(d.m)).y0(H - margin.bottom).y1(d => y(d.p)).curve(d3.curveMonotoneX);
      svg.append('path').datum(ph).attr('d', area).attr('fill', DL[0]).attr('opacity', .08);

      const line = d3.line().x(d => x(d.m)).y(d => y(d.p)).curve(d3.curveMonotoneX);
      svg.append('path').datum(ph).attr('d', line)
        .attr('fill', 'none').attr('stroke', DL[0]).attr('stroke-width', 2);

      svg.selectAll(null).data(ph).enter().append('circle')
        .attr('cx', d => x(d.m)).attr('cy', d => y(d.p))
        .attr('r', 2.5).attr('fill', DL[0]);
    }

    return {
      raw, selectedCategory, tooltipItem,
      allCategories, categoryList, filteredItems, filteredMonthly,
      currentMetrics, lastMonth,
      fmt: fmtNum, fmtK, openTooltip
    };
  }
}).mount('#app');
