import AVFoundation
import QuartzCore
import React
import UIKit

#if canImport(Libmpv)

/// The layer mpv draws into.
final class PorticoMpvMetalLayer: CAMetalLayer {
    /// The renderer briefly sets a 1×1 drawable to flush a presentation. Passing that on makes
    /// the picture flash, so it is ignored.
    override var drawableSize: CGSize {
        get { return super.drawableSize }
        set { if newValue.width > 1, newValue.height > 1 { super.drawableSize = newValue } }
    }
}

/// The mpv engine's picture, for the lease it is given. The engine and its layer outlive this
/// view; the view only shows the layer while its lease is the engine's current one, and draws
/// the plain-text subtitle line over it when the app (not mpv) is drawing the chosen track.
@objc(PorticoMpvPlayerView)
final class PorticoMpvPlayerView: UIView {
    @objc var lease: String? {
        didSet { attach() }
    }

    /// mpv has no Picture in Picture. A request is answered "unavailable", as the AVPlayer view
    /// answers on a device without it, so the player hides the button.
    @objc var pictureInPictureRequest: Int = 0 {
        didSet {
            guard pictureInPictureRequest != oldValue else { return }
            PorticoMpvPlaybackModule.pictureInPicture(["lease": lease ?? "", "state": "unavailable"])
        }
    }

    private let subtitle = UILabel()
    private var showing = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        subtitle.textColor = .white
        subtitle.backgroundColor = UIColor(white: 0, alpha: 0.7)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0
        subtitle.isUserInteractionEnabled = false
        subtitle.isHidden = true
        subtitle.isAccessibilityElement = true
        addSubview(subtitle)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(attach), name: .porticoMpvAttachmentChanged, object: nil)
        center.addObserver(self, selector: #selector(updateSubtitle), name: .porticoMpvOverlayChanged, object: nil)
    }

    required init?(coder: NSCoder) { return nil }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// Leaving the window is where the picture is handed back: by `deinit` the engine's weak
    /// reference to this view has already gone.
    override func willMove(toWindow newWindow: UIWindow?) {
        if newWindow == nil, showing, let controller = PorticoMpvController.shared {
            showing = false
            if controller.metalLayer.superlayer === layer { controller.metalLayer.removeFromSuperlayer() }
            controller.detach(self)
        }
        super.willMove(toWindow: newWindow)
    }

    private var leased: Bool {
        guard let lease = lease, !lease.isEmpty, let controller = PorticoMpvController.shared else { return false }
        return controller.lease == lease
    }

    @objc private func attach() {
        guard let controller = PorticoMpvController.shared else { return }
        if leased, window != nil {
            if controller.metalLayer.superlayer !== layer {
                controller.metalLayer.removeFromSuperlayer()
                layer.insertSublayer(controller.metalLayer, at: 0)
            }
            showing = true
            controller.attach(self)
            setNeedsLayout()
        } else if showing {
            showing = false
            if controller.metalLayer.superlayer === layer { controller.metalLayer.removeFromSuperlayer() }
            controller.detach(self)
        }
        updateSubtitle()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        attach()
    }

    @objc private func updateSubtitle() {
        let text = leased ? (PorticoMpvController.shared?.overlayText ?? "") : ""
        subtitle.text = text
        subtitle.isHidden = text.isEmpty
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let controller = PorticoMpvController.shared else { return }
        if showing, bounds.width >= 2, bounds.height >= 2 {
            let scale = window?.screen.nativeScale ?? UIScreen.main.nativeScale
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            controller.metalLayer.frame = bounds
            controller.metalLayer.contentsScale = scale
            controller.metalLayer.drawableSize = CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
            CATransaction.commit()
        }
        // The line sits inside the picture, not in the bars above and below it: the same place
        // and the same look as the AVPlayer engine's.
        var video = bounds
        if let aspect = controller.videoAspect, aspect > 0, bounds.width > 0, bounds.height > 0 {
            video = AVMakeRect(aspectRatio: CGSize(width: aspect, height: 1), insideRect: bounds)
        }
        let cue = controller.overlayCue
        let width = video.width * 0.9
        let fontSize = max(12, min(40, video.width * 0.035)) * CGFloat(PorticoMpvSupport.captionScale())
        let italic = (cue["italic"] as? Bool) ?? false
        subtitle.font = italic ? UIFont.italicSystemFont(ofSize: fontSize) : UIFont.systemFont(ofSize: fontSize, weight: .medium)
        let size = subtitle.sizeThatFits(CGSize(width: width, height: video.height * 0.6))
        let height = min(size.height + 8, video.height * 0.6)
        let top = (cue["top"] as? Bool) ?? false
        let y = top ? max(video.minY + 8, safeAreaInsets.top) : video.maxY - max(8, video.height * 0.08) - height
        subtitle.frame = CGRect(x: video.midX - width / 2, y: y, width: width, height: height)
    }
}

#else

/// Built without the mpv libraries: the view exists so the app's screens need no special case,
/// and shows nothing. The engine module says it is unavailable and JavaScript never selects it.
@objc(PorticoMpvPlayerView)
final class PorticoMpvPlayerView: UIView {
    @objc var lease: String?
    @objc var pictureInPictureRequest: Int = 0
}

#endif

@objc(PorticoMpvPlayerManager)
final class PorticoMpvPlayerManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { return true }
    override func view() -> UIView! { return PorticoMpvPlayerView() }
}
