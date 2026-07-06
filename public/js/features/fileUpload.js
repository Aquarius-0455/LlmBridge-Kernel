import { setCurrentAttachment } from '../state.js';
import { MAX_ATTACHMENT_SIZE } from '../constants.js';
import { showToast } from '../ui/toast.js';

export function initFileUpload() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const badgeContainer = document.getElementById('attachment-badge-container');
  
  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_SIZE) {
      showToast("文件大小超出限制 (最大 5MB)", "error");
      fileInput.value = '';
      return;
    }

    const isImage = file.type.startsWith('image/');

    if (isImage) {
      resizeImageIfNeeded(file, 2048).then(attachment => {
        setCurrentAttachment(attachment);
        renderBadge();
      });
    } else {
      const reader = new FileReader();
      reader.onload = function(event) {
        setCurrentAttachment({
          name: file.name,
          type: file.type,
          isImage: false,
          content: event.target.result
        });
        renderBadge();
      };
      reader.readAsText(file);
    }

    function renderBadge() {
      badgeContainer.innerHTML = `
        <div class="attachment-badge">
          <span>${file.name}</span>
          <button class="btn-remove-attachment" title="取消文件附件">×</button>
        </div>
      `;

      badgeContainer.querySelector('.btn-remove-attachment').addEventListener('click', () => {
        setCurrentAttachment(null);
        badgeContainer.innerHTML = '';
        fileInput.value = '';
      });
    }
  });
}

function resizeImageIfNeeded(file, maxDim = 2048) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;

        if (width <= maxDim && height <= maxDim) {
          resolve({
            name: file.name,
            type: file.type,
            isImage: true,
            content: e.target.result
          });
          return;
        }

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataURL = canvas.toDataURL(file.type || 'image/jpeg', 0.85);
        resolve({
          name: file.name,
          type: file.type || 'image/jpeg',
          isImage: true,
          content: dataURL
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
