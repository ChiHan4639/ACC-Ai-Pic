document.addEventListener('DOMContentLoaded', () => {
    // 圖片參數設定
    const imageConfig = {
        width: 15000,          // 原圖寬度，更新為15000px
        height: 3750,          // 原圖高度，更新為3750px
        tileSize: 1000,        // 每個分片的大小
        baseUrl: 'images/',    // 分片圖片的資料夾路徑
        fileExtension: '.jpg'  // 圖片副檔名
    };

    // 計算需要多少分片
    const tilesX = Math.ceil(imageConfig.width / imageConfig.tileSize);
    const tilesY = Math.ceil(imageConfig.height / imageConfig.tileSize);

    // 獲取DOM元素
    const imageViewer = document.getElementById('image-viewer');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const resetBtn = document.getElementById('reset');

    // 建立載入指示器
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.textContent = '載入中...';
    document.querySelector('.image-viewer-container').appendChild(loadingIndicator);

    // 視圖狀態
    let viewState = {
        scale: 0.2,               // 初始縮放比例
        translateX: 0,            // X軸位移
        translateY: 0,            // Y軸位移
        targetTranslateX: 0,      // 動畫目標X位移
        targetTranslateY: 0,      // 動畫目標Y位移
        targetScale: 0.2,         // 動畫目標縮放比例
        isDragging: false,        // 是否正在拖動
        isAnimating: false,       // 是否正在動畫
        startX: 0,                // 拖動開始的X座標
        startY: 0,                // 拖動開始的Y座標
        lastUpdateTime: 0,        // 上次更新可見分片的時間
        loadedTiles: new Set(),   // 已加載的分片集合
        visibleTiles: new Set(),  // 可見的分片集合
        tileElements: {},         // 分片元素的引用
        dragDistance: 0,          // 拖動距離累計，用於判斷何時更新分片
        isPinching: false,         // 是否正在進行雙指捏合縮放
        initialPinchDistance: 0,   // 雙指捏合縮放的初始距離
        pinchCenterX: 0,           // 雙指捏合縮放的中心點X座標
        pinchCenterY: 0,           // 雙指捏合縮放的中心點Y座標
        pinchImageX: 0,            // 雙指捏合縮放的圖像絕對位置X座標
        pinchImageY: 0,            // 雙指捏合縮放的圖像絕對位置Y座標
        lastTapTime: 0             // 上次點擊時間，用於檢測雙擊
    };

    // 動畫ID
    let animationFrameId = null;
    
    // 獲取實際可視高度，處理手機瀏覽器的地址欄問題
    function getVisualViewportHeight() {
        // 如果支援visualViewport API (較新的瀏覽器)
        if (window.visualViewport) {
            return window.visualViewport.height;
        }
        // 回退到窗口內部高度
        return window.innerHeight;
    }
    
    // 更新視口大小
    function updateViewportSize() {
        const container = document.querySelector('.image-viewer-container');
        // 設置容器高度為當前視口實際高度
        container.style.height = `${getVisualViewportHeight()}px`;
        
        // 在iOS上特別處理，防止彈性滾動和地址欄隱藏問題
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            document.body.style.height = `${getVisualViewportHeight()}px`;
        }
    }

    // 初始化函數
    function initialize() {
        // 首先更新視口大小
        updateViewportSize();
        
        // 設定圖片容器初始寬高
        updateViewerSize();
        
        // 註冊事件監聽器
        registerEventListeners();
        
        // 初始化視圖
        updateViewTransform();
        
        // 首次加載可見分片
        updateVisibleTiles(true);
    }

    // 更新圖片查看器的尺寸
    function updateViewerSize() {
        imageViewer.style.width = imageConfig.width + 'px';
        imageViewer.style.height = imageConfig.height + 'px';
    }

    // 註冊事件監聽器
    function registerEventListeners() {
        // 縮放按鈕
        zoomInBtn.addEventListener('click', () => {
            zoomBy(1.2);
        });
        
        zoomOutBtn.addEventListener('click', () => {
            zoomBy(0.8);
        });
        
        resetBtn.addEventListener('click', resetView);
        
        // 滾輪縮放
        imageViewer.parentElement.addEventListener('wheel', handleWheel, { passive: false });
        
        // 拖動平移
        imageViewer.addEventListener('mousedown', startDrag);
        window.addEventListener('mousemove', drag);
        window.addEventListener('mouseup', endDrag);
        
        // 觸控支援
        imageViewer.addEventListener('touchstart', handleTouchStart, { passive: false });
        imageViewer.addEventListener('touchmove', handleTouchMove, { passive: false });
        imageViewer.addEventListener('touchend', handleTouchEnd);
        
        // 視窗大小變化時更新
        window.addEventListener('resize', () => {
            updateViewportSize();
            resetView();
            updateVisibleTiles(true);
        });
        
        // 視口大小變化處理（支援visualViewport API的瀏覽器）
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                updateViewportSize();
                resetView();
                updateVisibleTiles(true);
            });
        }
        
        // 處理移動設備上的方向改變
        window.addEventListener('orientationchange', () => {
            // 延遲更新以確保方向已經完全改變
            setTimeout(() => {
                updateViewportSize();
                resetView();
                updateVisibleTiles(true);
            }, 200);
        });
    }

    // 滾輪事件處理
    function handleWheel(event) {
        event.preventDefault();
        
        // 獲取滑鼠在查看器中的位置
        const container = imageViewer.parentElement;
        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        // 計算縮放前滑鼠所在的圖像絕對位置
        const beforeZoomX = (mouseX - viewState.translateX) / viewState.scale;
        const beforeZoomY = (mouseY - viewState.translateY) / viewState.scale;
        
        // 根據滾輪方向確定縮放因子
        const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.05, Math.min(2, viewState.scale * zoomFactor));
        
        // 計算縮放後需要的位移調整，以保持滑鼠下的點不變
        viewState.scale = newScale;
        viewState.translateX += mouseX - (beforeZoomX * newScale + viewState.translateX);
        viewState.translateY += mouseY - (beforeZoomY * newScale + viewState.translateY);
        
        // 應用變換
        updateViewTransform();
        
        // 更新可見分片
        updateVisibleTiles(true);
        
        // 縮放後檢查是否需要邊界修正
        checkAndFixBoundaries(true);
    }

    // 按倍率縮放
    function zoomBy(factor) {
        // 計算中心點
        const container = imageViewer.parentElement;
        const centerX = container.offsetWidth / 2;
        const centerY = container.offsetHeight / 2;
        
        // 計算縮放前中心點所在的圖像絕對位置
        const beforeZoomX = (centerX - viewState.translateX) / viewState.scale;
        const beforeZoomY = (centerY - viewState.translateY) / viewState.scale;
        
        // 計算新的縮放比例，限制最小和最大值
        const newScale = Math.max(0.05, Math.min(2, viewState.scale * factor));
        
        // 計算縮放後需要的位移調整，以保持中心點不變
        viewState.scale = newScale;
        viewState.translateX = centerX - beforeZoomX * newScale;
        viewState.translateY = centerY - beforeZoomY * newScale;
        
        // 應用變換並更新可見分片
        updateViewTransform();
        updateVisibleTiles(true);
        
        // 縮放後檢查是否需要邊界修正
        checkAndFixBoundaries(true);
    }

    // 重設視圖
    function resetView() {
        // 計算適合容器的初始縮放比例和位置
        const container = imageViewer.parentElement;
        
        // 直接設定高度適應視窗高度
        viewState.scale = container.offsetHeight / imageConfig.height;
        
        // 水平左對齊，而非之前的居中
        viewState.translateX = 0;
        // 垂直置頂
        viewState.translateY = 0;
        
        // 設置目標位置與當前位置相同，避免不必要的動畫
        viewState.targetTranslateX = viewState.translateX;
        viewState.targetTranslateY = viewState.translateY;
        viewState.targetScale = viewState.scale;
        
        // 應用變換並更新可見分片
        updateViewTransform();
        updateVisibleTiles(true);
    }

    // 開始拖動
    function startDrag(event) {
        if (event.button !== 0) return; // 只處理左鍵點擊
        
        // 如果正在動畫中，停止動畫
        if (viewState.isAnimating) {
            cancelAnimationFrame(animationFrameId);
            viewState.isAnimating = false;
        }
        
        viewState.isDragging = true;
        viewState.startX = event.clientX - viewState.translateX;
        viewState.startY = event.clientY - viewState.translateY;
        viewState.dragDistance = 0;
        
        imageViewer.style.cursor = 'grabbing';
        event.preventDefault();
    }

    // 拖動過程
    function drag(event) {
        if (!viewState.isDragging) return;
        
        const newTranslateX = event.clientX - viewState.startX;
        const newTranslateY = event.clientY - viewState.startY;
        
        // 計算拖動距離
        const dx = newTranslateX - viewState.translateX;
        const dy = newTranslateY - viewState.translateY;
        viewState.dragDistance += Math.sqrt(dx * dx + dy * dy);
        
        viewState.translateX = newTranslateX;
        viewState.translateY = newTranslateY;
        
        updateViewTransform();
        
        // 根據拖動距離和時間決定是否更新分片
        const now = Date.now();
        // 如果拖動了一定距離或距上次更新超過一定時間，則更新分片
        if (viewState.dragDistance > 50 || now - viewState.lastUpdateTime > 200) {
            updateVisibleTiles(false);
            viewState.dragDistance = 0;
            viewState.lastUpdateTime = now;
        }
        
        event.preventDefault();
    }

    // 結束拖動
    function endDrag() {
        if (!viewState.isDragging) return;
        
        viewState.isDragging = false;
        imageViewer.style.cursor = 'grab';
        
        // 檢查並修正邊界
        checkAndFixBoundaries(true);
        
        // 拖動結束後強制更新可見分片
        updateVisibleTiles(true);
    }

    // 觸控事件處理
    function handleTouchStart(event) {
        event.preventDefault();
        
        // 如果正在動畫中，停止動畫
        if (viewState.isAnimating) {
            cancelAnimationFrame(animationFrameId);
            viewState.isAnimating = false;
        }
        
        // 記錄觸摸開始時間，用於檢測雙擊
        const now = Date.now();
        
        // 處理雙指捏合縮放
        if (event.touches.length === 2) {
            // 雙指縮放模式
            viewState.isPinching = true;
            
            // 計算兩指之間的初始距離
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            viewState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            
            // 計算縮放的中心點
            const centerX = (touch1.clientX + touch2.clientX) / 2;
            const centerY = (touch1.clientY + touch2.clientY) / 2;
            
            // 記錄中心點在圖片上的位置
            const rect = imageViewer.parentElement.getBoundingClientRect();
            viewState.pinchCenterX = centerX - rect.left;
            viewState.pinchCenterY = centerY - rect.top;
            
            // 記錄縮放前中心點所在的圖像絕對位置
            viewState.pinchImageX = (viewState.pinchCenterX - viewState.translateX) / viewState.scale;
            viewState.pinchImageY = (viewState.pinchCenterY - viewState.translateY) / viewState.scale;
            
            // 不進入拖動模式
            return;
        } 
        
        // 處理單指操作 (拖動或可能的雙擊)
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            
            // 如果是雙擊 (兩次點擊間隔小於300毫秒)
            if (viewState.lastTapTime && now - viewState.lastTapTime < 300) {
                // 清除雙擊計時，避免連續多次雙擊
                viewState.lastTapTime = 0;
                
                // 獲取雙擊位置
                const containerRect = imageViewer.parentElement.getBoundingClientRect();
                const touchX = touch.clientX - containerRect.left;
                const touchY = touch.clientY - containerRect.top;
                
                // 計算雙擊位置在圖片上的絕對位置
                const imageX = (touchX - viewState.translateX) / viewState.scale;
                const imageY = (touchY - viewState.translateY) / viewState.scale;
                
                // 切換縮放級別 (在較大和較小縮放級別間切換)
                // 如果當前縮放比例較小，則放大到2倍
                // 如果當前縮放比例較大，則縮小到適合視窗的縮放比例
                const fitScale = imageViewer.parentElement.offsetHeight / imageConfig.height;
                const largeScale = Math.min(2, fitScale * 2.5); // 放大到2.5倍，但不超過2
                
                let targetScale;
                if (viewState.scale < fitScale * 1.5) {
                    targetScale = largeScale; // 放大
                } else {
                    targetScale = fitScale; // 縮小到初始狀態
                }
                
                // 設置目標縮放比例和位置 (以雙擊點為中心進行縮放)
                viewState.targetScale = targetScale;
                viewState.targetTranslateX = touchX - imageX * targetScale;
                viewState.targetTranslateY = touchY - imageY * targetScale;
                
                // 開始縮放動畫
                startBoundaryAnimation();
                
                // 不進入拖動模式
                return;
            }
            
            // 記錄本次點擊時間，用於下次檢測雙擊
            viewState.lastTapTime = now;
            
            // 正常的拖動模式
            viewState.isDragging = true;
            viewState.startX = touch.clientX - viewState.translateX;
            viewState.startY = touch.clientY - viewState.translateY;
            viewState.dragDistance = 0;
        }
    }

    function handleTouchMove(event) {
        event.preventDefault();
        
        // 處理雙指捏合縮放
        if (viewState.isPinching && event.touches.length === 2) {
            // 計算當前兩指距離
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);
            
            // 計算縮放比例變化
            const scaleFactor = currentDistance / viewState.initialPinchDistance;
            
            // 調整靈敏度：從1.5降低到1.2，讓縮放不那麼敏感
            const sensitivityFactor = 1.2;
            const newScale = Math.max(0.05, Math.min(2, viewState.scale * Math.pow(scaleFactor, sensitivityFactor)));
            
            // 更新位置以保持中心點不變
            viewState.scale = newScale;
            viewState.translateX = viewState.pinchCenterX - viewState.pinchImageX * newScale;
            viewState.translateY = viewState.pinchCenterY - viewState.pinchImageY * newScale;
            
            // 更新縮放
            updateViewTransform();
            updateVisibleTiles(false);
            
            // 更新初始距離，使縮放更流暢
            viewState.initialPinchDistance = currentDistance;
            return;
        }
        
        // 處理拖動
        if (viewState.isDragging && event.touches.length === 1) {
            const touch = event.touches[0];
            const newTranslateX = touch.clientX - viewState.startX;
            const newTranslateY = touch.clientY - viewState.startY;
            
            // 計算拖動距離
            const dx = newTranslateX - viewState.translateX;
            const dy = newTranslateY - viewState.translateY;
            viewState.dragDistance += Math.sqrt(dx * dx + dy * dy);
            
            viewState.translateX = newTranslateX;
            viewState.translateY = newTranslateY;
            
            updateViewTransform();
            
            // 根據拖動距離和時間決定是否更新分片
            const now = Date.now();
            if (viewState.dragDistance > 50 || now - viewState.lastUpdateTime > 200) {
                updateVisibleTiles(false);
                viewState.dragDistance = 0;
                viewState.lastUpdateTime = now;
            }
        }
    }

    function handleTouchEnd(event) {
        // 結束捏合縮放模式
        if (viewState.isPinching) {
            viewState.isPinching = false;
            
            // 檢查並修正邊界
            checkAndFixBoundaries(true);
            updateVisibleTiles(true);
            return;
        }
        
        // 結束拖動模式
        if (viewState.isDragging) {
            viewState.isDragging = false;
            
            // 檢查並修正邊界
            checkAndFixBoundaries(true);
            updateVisibleTiles(true);
        }
    }

    // 檢查並修正超出邊界的情況
    function checkAndFixBoundaries(animate = true) {
        const container = imageViewer.parentElement;
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        
        // 保存當前縮放的中心點，用於維持縮放中心
        // 對於縮放操作，我們希望保持縮放中心不變
        // 記錄中心點在圖片上的相對位置
        let centerX, centerY;
        
        // 如果是通過捏合縮放，使用捏合的中心點
        if (viewState.isPinching) {
            centerX = viewState.pinchImageX;
            centerY = viewState.pinchImageY;
        } else {
            // 否則使用屏幕中心
            centerX = (containerWidth / 2 - viewState.translateX) / viewState.scale;
            centerY = (containerHeight / 2 - viewState.translateY) / viewState.scale;
        }
        
        // 計算圖片的縮放後尺寸
        const scaledWidth = imageConfig.width * viewState.scale;
        const scaledHeight = imageConfig.height * viewState.scale;
        
        // 縮放修正：以高度為基準，確保圖片高度始終填滿視窗
        let targetScale = viewState.scale;
        let scaleChanged = false;
        
        // 計算使圖片高度填滿視窗所需的最小縮放
        const minScaleForHeight = containerHeight / imageConfig.height;
        
        // 如果當前縮放比例小於使圖片高度填滿視窗所需的縮放比例，則調整縮放
        if (viewState.scale < minScaleForHeight) {
            targetScale = minScaleForHeight;
            scaleChanged = true;
        }
        
        // 重新計算縮放後的尺寸
        const targetScaledWidth = imageConfig.width * targetScale;
        const targetScaledHeight = imageConfig.height * targetScale;
        
        // 計算有效的位移範圍
        let minTranslateX, maxTranslateX, minTranslateY, maxTranslateY;
        
        // 如果縮放後的圖片寬度比容器小，則水平居中
        if (targetScaledWidth <= containerWidth) {
            minTranslateX = maxTranslateX = (containerWidth - targetScaledWidth) / 2;
        } else {
            // 否則限制左右邊界
            minTranslateX = containerWidth - targetScaledWidth;
            maxTranslateX = 0;
        }
        
        // 垂直方向總是置頂，除非圖片高度大於容器高度，則限制上下邊界
        if (targetScaledHeight <= containerHeight) {
            // 置頂顯示
            minTranslateY = maxTranslateY = 0;
        } else {
            // 限制上下邊界，不允許露出底部底色
            minTranslateY = containerHeight - targetScaledHeight;
            maxTranslateY = 0;
        }
        
        // 如果縮放比例改變，計算新的位置以保持縮放中心點
        let targetX = viewState.translateX;
        let targetY = viewState.translateY;
        
        if (scaleChanged) {
            // 根據保存的中心點計算新的位置
            targetX = containerWidth / 2 - centerX * targetScale;
            targetY = containerHeight / 2 - centerY * targetScale;
        }
        
        // 限制邊界
        targetX = Math.min(maxTranslateX, Math.max(minTranslateX, targetX));
        targetY = Math.min(maxTranslateY, Math.max(minTranslateY, targetY));
        
        // 檢查是否需要修正
        const needsCorrection = targetX !== viewState.translateX || 
                              targetY !== viewState.translateY || 
                              targetScale !== viewState.scale;
        
        if (needsCorrection) {
            if (animate) {
                // 設置動畫目標
                viewState.targetTranslateX = targetX;
                viewState.targetTranslateY = targetY;
                viewState.targetScale = targetScale;
                
                // 開始動畫
                startBoundaryAnimation();
            } else {
                // 直接修正位置
                viewState.translateX = targetX;
                viewState.translateY = targetY;
                viewState.scale = targetScale;
                updateViewTransform();
                updateVisibleTiles(false);
            }
        }
        
        return needsCorrection;
    }

    // 開始邊界修正動畫
    function startBoundaryAnimation() {
        if (viewState.isAnimating) {
            cancelAnimationFrame(animationFrameId);
        }
        
        viewState.isAnimating = true;
        const startTime = Date.now();
        const startX = viewState.translateX;
        const startY = viewState.translateY;
        const startScale = viewState.scale;
        const targetX = viewState.targetTranslateX;
        const targetY = viewState.targetTranslateY;
        const targetScale = viewState.targetScale;
        const duration = 300; // 動畫時長，毫秒
        
        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // 使用緩動函數使動畫更加平滑
            const easeProgress = easeOutCubic(progress);
            
            // 計算當前位置和縮放
            viewState.translateX = startX + (targetX - startX) * easeProgress;
            viewState.translateY = startY + (targetY - startY) * easeProgress;
            viewState.scale = startScale + (targetScale - startScale) * easeProgress;
            
            // 應用變換
            updateViewTransform();
            
            // 每幾幀更新一次可見分片，避免卡頓
            if (elapsed % 60 < 16) { // 大約每4幀更新一次
                updateVisibleTiles(false);
            }
            
            // 如果動畫未完成，繼續
            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animate);
            } else {
                // 動畫完成
                viewState.isAnimating = false;
                updateVisibleTiles(true);
            }
        }
        
        // 開始動畫
        animationFrameId = requestAnimationFrame(animate);
    }
    
    // 緩動函數：緩出立方
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    // 更新視圖變換
    function updateViewTransform() {
        const transform = `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`;
        imageViewer.style.transform = transform;
    }

    // 更新可見分片
    function updateVisibleTiles(forceUpdate = false) {
        // 顯示載入指示器，但僅在強制更新時或大幅度移動時
        if (forceUpdate) {
            loadingIndicator.style.display = 'block';
        }
        
        // 獲取容器和視窗信息
        const container = imageViewer.parentElement;
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        
        // 計算可見區域在原圖中的範圍
        const visibleLeft = Math.max(0, -viewState.translateX / viewState.scale);
        const visibleTop = Math.max(0, -viewState.translateY / viewState.scale);
        const visibleRight = Math.min(imageConfig.width, (containerWidth - viewState.translateX) / viewState.scale);
        const visibleBottom = Math.min(imageConfig.height, (containerHeight - viewState.translateY) / viewState.scale);
        
        // 增加緩衝區，預加載周圍的分片
        const bufferSize = imageConfig.tileSize * 1; // 加載額外的一圈分片
        const bufferedLeft = Math.max(0, visibleLeft - bufferSize);
        const bufferedTop = Math.max(0, visibleTop - bufferSize);
        const bufferedRight = Math.min(imageConfig.width, visibleRight + bufferSize);
        const bufferedBottom = Math.min(imageConfig.height, visibleBottom + bufferSize);
        
        // 計算可見的分片範圍（含緩衝區）
        const startTileX = Math.floor(bufferedLeft / imageConfig.tileSize);
        const startTileY = Math.floor(bufferedTop / imageConfig.tileSize);
        const endTileX = Math.ceil(bufferedRight / imageConfig.tileSize);
        const endTileY = Math.ceil(bufferedBottom / imageConfig.tileSize);
        
        // 保存舊的可見分片集合進行比較
        const oldVisibleTiles = new Set(viewState.visibleTiles);
        
        // 重置當前可見分片集合
        viewState.visibleTiles.clear();
        
        // 計算新的可見分片
        for (let y = startTileY; y < endTileY && y < tilesY; y++) {
            for (let x = startTileX; x < endTileX && x < tilesX; x++) {
                const tileId = `${x}-${y}`;
                viewState.visibleTiles.add(tileId);
                
                // 如果分片尚未加載，則加載
                if (!viewState.loadedTiles.has(tileId)) {
                    loadTile(x, y);
                } else if (viewState.tileElements[tileId] && !viewState.tileElements[tileId].parentNode) {
                    // 如果分片已加載但不在DOM中，重新添加
                    imageViewer.appendChild(viewState.tileElements[tileId]);
                }
            }
        }
        
        // 只有在強制更新時才清除不可見分片
        if (forceUpdate) {
            // 清除不再可見的分片元素（保留緩存）
            for (const tileId in viewState.tileElements) {
                if (!viewState.visibleTiles.has(tileId)) {
                    const tileElement = viewState.tileElements[tileId];
                    if (tileElement && tileElement.parentNode) {
                        tileElement.parentNode.removeChild(tileElement);
                        // 不刪除元素引用，保留在緩存中以便快速重用
                    }
                }
            }
        }
        
        // 檢查是否有新添加的可見分片
        let hasNewVisibleTiles = false;
        for (const tileId of viewState.visibleTiles) {
            if (!oldVisibleTiles.has(tileId)) {
                hasNewVisibleTiles = true;
                break;
            }
        }
        
        // 當所有可見分片都已加載時，隱藏載入指示器
        if (forceUpdate || hasNewVisibleTiles) {
            const allVisible = Array.from(viewState.visibleTiles).every(tileId => 
                viewState.loadedTiles.has(tileId));
            
            if (allVisible) {
                loadingIndicator.style.display = 'none';
            }
        } else {
            // 如果沒有新的可見分片，也隱藏載入指示器
            loadingIndicator.style.display = 'none';
        }
    }

    // 加載分片
    function loadTile(tileX, tileY) {
        const tileId = `${tileX}-${tileY}`;
        
        // 如果此分片正在加載或已加載，則跳過
        if (viewState.loadedTiles.has(tileId) || viewState.tileElements[tileId]) {
            return;
        }
        
        // 建立分片元素
        const tileElement = document.createElement('div');
        tileElement.className = 'image-tile';
        
        // 計算分片在原圖中的位置和實際尺寸
        const left = tileX * imageConfig.tileSize;
        const top = tileY * imageConfig.tileSize;
        const width = Math.min(imageConfig.tileSize, imageConfig.width - left);
        const height = Math.min(imageConfig.tileSize, imageConfig.height - top);
        
        // 設定分片樣式
        tileElement.style.left = left + 'px';
        tileElement.style.top = top + 'px';
        tileElement.style.width = width + 'px';
        tileElement.style.height = height + 'px';
        
        // 將分片添加到容器
        imageViewer.appendChild(tileElement);
        viewState.tileElements[tileId] = tileElement;
        
        // 建立圖片URL
        const imgUrl = `${imageConfig.baseUrl}tile_${tileX}_${tileY}${imageConfig.fileExtension}`;
        
        // 預加載圖片
        const img = new Image();
        img.onload = () => {
            // 圖片加載完成後，將其設定為分片的背景
            tileElement.style.backgroundImage = `url('${imgUrl}')`;
            viewState.loadedTiles.add(tileId);
            
            // 檢查是否所有可見分片都已加載
            const allVisible = Array.from(viewState.visibleTiles).every(id => 
                viewState.loadedTiles.has(id));
            
            if (allVisible) {
                loadingIndicator.style.display = 'none';
            }
        };
        
        img.onerror = () => {
            console.error(`無法加載分片: ${imgUrl}`);
            // 顯示錯誤提示
            tileElement.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            tileElement.innerHTML = '<div style="color: red; padding: 10px;">圖片載入失敗</div>';
            viewState.loadedTiles.add(tileId); // 標記為已嘗試加載
        };
        
        // 開始加載圖片
        img.src = imgUrl;
    }

    // 初始化完成後重設視圖
    initialize();
    resetView();
    
    // 設置初始更新時間
    viewState.lastUpdateTime = Date.now();
}); 