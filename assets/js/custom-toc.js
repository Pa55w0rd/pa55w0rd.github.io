/**
 * 文章目录：宽屏目录放入 #sidebar 并与 article 顶部对齐；滚动时 sticky 跟随视口；窄屏目录在正文上方可折叠
 * 关闭：front-matter toc: false（body data-toc="off"）
 */
(function () {
  'use strict';

  var DESKTOP_MIN = 1080;

  function slugify(text) {
    var s = (text || '').trim()
      .replace(/\s+/g, '-')
      .replace(/[^0-9a-zA-Z\u4e00-\u9fff\-_]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return s.substring(0, 56);
  }

  function ensureHeadingId(heading, fallbackIndex) {
    if (heading.id && String(heading.id).trim()) {
      return heading.id;
    }
    var base = slugify(heading.textContent) || ('section-' + fallbackIndex);
    var id = base;
    var n = 0;
    var doc = heading.ownerDocument;
    while (doc.getElementById(id)) {
      id = base + '-' + (++n);
    }
    heading.id = id;
    return id;
  }

  function buildTree(headings) {
    var root = { level: 0, children: [] };
    var stack = [root];
    Array.prototype.forEach.call(headings, function (h) {
      var level = parseInt(h.tagName.charAt(1), 10);
      if (isNaN(level) || level < 1 || level > 6) return;
      var node = { heading: h, level: level, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    return root.children;
  }

  var idSeq = 0;

  function renderBranch(nodes, isRoot) {
    var ol = document.createElement('ol');
    ol.className = isRoot ? 'toc toc-root toc-numbered' : 'toc toc-nested toc-numbered';
    nodes.forEach(function (node) {
      var li = document.createElement('li');
      li.className = 'toc-item toc-depth-' + node.level;
      var a = document.createElement('a');
      var hid = ensureHeadingId(node.heading, ++idSeq);
      a.href = '#' + hid;
      a.textContent = node.heading.textContent.trim();
      li.appendChild(a);
      if (node.children.length) {
        li.appendChild(renderBranch(node.children, false));
      }
      ol.appendChild(li);
    });
    return ol;
  }

  function isPostArticlePage() {
    if (document.body && document.body.getAttribute('data-toc') === 'off') {
      return false;
    }
    var path = window.location.pathname || '';
    if (path === '/' || (/index\.html?$/.test(path) && path.replace(/\/index\.html?$/, '') === '')) {
      return false;
    }
    if (/\/(categories|tags|archives|page)\b/.test(path)) {
      return false;
    }
    return !!document.querySelector('article.article-type-post .article-entry');
  }

  function TOCManager() {
    this.tocContainer = null;
    this.tocTitle = null;
    this.tocList = null;
    this.tocLinks = [];
    this.headings = [];
    this.isCollapsed = false;
    this.currentActiveLink = null;
    this.entry = null;
    this.init();
  }

  TOCManager.prototype.init = function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', this.setup.bind(this));
    } else {
      this.setup();
    }
  };

  TOCManager.prototype.setup = function () {
    if (!isPostArticlePage()) return;

    this.entry = document.querySelector('article.article-type-post .article-entry');
    if (!this.entry) return;

    var headings = this.entry.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (!headings.length) {
      document.body.classList.add('post-toc-show-widgets');
      return;
    }

    var tree = buildTree(headings);
    if (!tree.length) {
      document.body.classList.add('post-toc-show-widgets');
      return;
    }

    this.tocContainer = document.createElement('nav');
    this.tocContainer.id = 'post-toc';
    this.tocContainer.className = 'toc-container';
    this.tocContainer.setAttribute('aria-label', '目录');

    var progressBar = document.createElement('div');
    progressBar.className = 'toc-progress';
    progressBar.setAttribute('aria-hidden', 'true');

    this.tocTitle = document.createElement('button');
    this.tocTitle.type = 'button';
    this.tocTitle.className = 'toc-title';
    this.tocTitle.setAttribute('aria-expanded', 'true');
    this.tocTitle.innerHTML = '<span class="toc-title-text">目录</span><span class="toc-title-toggle" aria-hidden="true"></span>';

    this.tocList = renderBranch(tree, true);
    this.tocList.classList.add('toc-expanded');

    this.tocContainer.appendChild(progressBar);
    this.tocContainer.appendChild(this.tocTitle);
    this.tocContainer.appendChild(this.tocList);

    this.mount();

    var links = this.tocContainer.querySelectorAll('a[href^="#"]');
    this.tocLinks = Array.prototype.slice.call(links);
    this.headings = this.tocLinks.map(function (link) {
      var id = link.getAttribute('href').slice(1);
      return document.getElementById(id);
    }).filter(Boolean);

    this.bindEvents();
    this.updateActiveLink();
    this.updateProgress();

    if (this.tocContainer.classList.contains('toc-container--sidebar')) {
      this.expand();
      var self = this;
      this.syncSidebarTocAlign();
      requestAnimationFrame(function () {
        self.syncSidebarTocAlign();
      });
      window.addEventListener('load', function onTocLoad() {
        window.removeEventListener('load', onTocLoad);
        self.syncSidebarTocAlign();
      });
      var mainEl = document.getElementById('main');
      if (mainEl && typeof window.ResizeObserver !== 'undefined') {
        this._mainResizeObserver = new window.ResizeObserver(function () {
          if (self.tocContainer.classList.contains('toc-container--sidebar')) {
            self.syncSidebarTocAlign();
          }
        });
        this._mainResizeObserver.observe(mainEl);
      }
    } else if (window.innerWidth < 768) {
      this.collapse();
    }
  };

  TOCManager.prototype.isDesktopLayout = function () {
    return window.innerWidth >= DESKTOP_MIN;
  };

  TOCManager.prototype.mount = function () {
    if (!this.tocContainer || !this.entry) return;

    var sidebar = document.getElementById('sidebar');
    var useSidebarToc = this.isDesktopLayout() && sidebar && !sidebar.closest('#footer');

    if (useSidebarToc) {
      var sRect = sidebar.getBoundingClientRect();
      if (sRect.left < 420) {
        useSidebarToc = false;
      }
    }

    if (useSidebarToc) {
      document.body.classList.add('post-toc-sidebar');
      this.tocContainer.classList.add('toc-container--sidebar');
      if (this.tocContainer.parentNode !== sidebar) {
        sidebar.insertBefore(this.tocContainer, sidebar.firstChild);
      }
      this.syncSidebarTocAlign();
    } else {
      document.body.classList.remove('post-toc-sidebar');
      this.tocContainer.classList.remove('toc-container--sidebar');
      var sbClear = document.getElementById('sidebar');
      if (sbClear) {
        sbClear.style.paddingTop = '';
        sbClear.style.minHeight = '';
      }
      document.documentElement.style.removeProperty('--toc-sticky-top');
      if (this.tocContainer.parentNode !== this.entry.parentNode ||
          this.tocContainer.nextSibling !== this.entry) {
        this.entry.parentNode.insertBefore(this.tocContainer, this.entry);
      }
    }
  };

  /**
   * 侧栏目录：与 article 顶部对齐；侧栏 min-height = 主栏高度（float 下列宽仅随目录高度时过短，sticky 无「跑道」会整列滚走）。
   * 写入 --toc-sticky-top 供 position:sticky 使用。
   */
  TOCManager.prototype.syncSidebarTocAlign = function () {
    var sidebar = document.getElementById('sidebar');
    if (!this.tocContainer || !this.tocContainer.classList.contains('toc-container--sidebar')) {
      if (sidebar) {
        sidebar.style.paddingTop = '';
        sidebar.style.minHeight = '';
      }
      document.documentElement.style.removeProperty('--toc-sticky-top');
      return;
    }
    var articleEl = document.querySelector('article.article-type-post');
    var main = document.getElementById('main');
    if (!articleEl || !sidebar) {
      return;
    }
    var delta = articleEl.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    sidebar.style.paddingTop = Math.max(0, Math.round(delta)) + 'px';

    if (main) {
      sidebar.style.minHeight = Math.round(main.offsetHeight) + 'px';
    }

    var header = document.getElementById('header');
    var stickyTop = 96;
    if (header) {
      stickyTop = Math.round(header.getBoundingClientRect().height) + 10;
    }
    document.documentElement.style.setProperty('--toc-sticky-top', stickyTop + 'px');
  };

  TOCManager.prototype.bindEvents = function () {
    var self = this;
    if (this.tocTitle) {
      this.tocTitle.addEventListener('click', function () {
        if (self.isDesktopLayout() && self.tocContainer.classList.contains('toc-container--sidebar')) {
          return;
        }
        if (self.isCollapsed) self.expand();
        else self.collapse();
      });
    }

    this.tocLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        self.smoothScrollTo(link.getAttribute('href'));
        if (window.innerWidth < 768) {
          setTimeout(function () { self.collapse(); }, 400);
        }
      });
    });

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          self.updateActiveLink();
          self.updateProgress();
          ticking = false;
        });
        ticking = true;
      }
    });

    var resizeT;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        self.mount();
        self.syncSidebarTocAlign();
        requestAnimationFrame(function () {
          self.syncSidebarTocAlign();
        });
        if (self.tocContainer.classList.contains('toc-container--sidebar')) {
          self.expand();
        } else if (window.innerWidth >= 768 && self.isCollapsed) {
          self.expand();
        } else if (window.innerWidth < 768) {
          self.collapse();
        }
      }, 120);
    });
  };

  TOCManager.prototype.expand = function () {
    if (!this.tocList) return;
    this.tocList.classList.remove('toc-collapsed');
    this.tocList.classList.add('toc-expanded');
    this.tocTitle.classList.remove('toc-title-collapsed');
    this.tocTitle.setAttribute('aria-expanded', 'true');
    this.isCollapsed = false;
  };

  TOCManager.prototype.collapse = function () {
    if (!this.tocList) return;
    this.tocList.classList.remove('toc-expanded');
    this.tocList.classList.add('toc-collapsed');
    this.tocTitle.classList.add('toc-title-collapsed');
    this.tocTitle.setAttribute('aria-expanded', 'false');
    this.isCollapsed = true;
  };

  TOCManager.prototype.smoothScrollTo = function (href) {
    var id = href.replace(/^#/, '');
    var el = document.getElementById(id);
    if (!el) return;
    var top = el.getBoundingClientRect().top + window.pageYOffset;
    var offset = window.innerWidth >= DESKTOP_MIN ? 100 : 72;
    window.scrollTo({ top: top - offset, behavior: 'smooth' });
  };

  TOCManager.prototype.scrollLinkIntoTocPanel = function (link) {
    if (!this.tocList || !link) return;
    var root = this.tocList;
    var lr = link.getBoundingClientRect();
    var rr = root.getBoundingClientRect();
    if (lr.top < rr.top + 40 || lr.bottom > rr.bottom - 8) {
      var delta = (lr.top - rr.top) - root.clientHeight / 2 + lr.height / 2;
      root.scrollTop += delta;
    }
  };

  TOCManager.prototype.updateActiveLink = function () {
    if (!this.headings.length) return;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var winH = window.innerHeight;
    var docH = document.documentElement.scrollHeight;
    var current = null;

    if (scrollTop + winH >= docH - 40) {
      current = this.headings[this.headings.length - 1];
    } else {
      for (var i = this.headings.length - 1; i >= 0; i--) {
        var h = this.headings[i];
        var t = h.getBoundingClientRect().top + scrollTop;
        if (scrollTop >= t - 110) {
          current = h;
          break;
        }
      }
    }

    if (!current) return;
    var idx = this.headings.indexOf(current);
    if (idx < 0) return;
    var link = this.tocLinks[idx];
    if (link === this.currentActiveLink) return;

    if (this.currentActiveLink) {
      this.currentActiveLink.classList.remove('toc-link-active');
    }
    link.classList.add('toc-link-active');
    this.currentActiveLink = link;
    this.scrollLinkIntoTocPanel(link);
  };

  TOCManager.prototype.updateProgress = function () {
    var bar = this.tocContainer && this.tocContainer.querySelector('.toc-progress');
    if (!bar) return;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max <= 0 ? 0 : Math.min(100, Math.max(0, (scrollTop / max) * 100));
    bar.style.height = p + '%';
  };

  function boot() {
    if (window.__hexoTOCInitialized) return;
    window.__hexoTOCInitialized = true;
    new TOCManager();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
