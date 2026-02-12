// Assuming you have a layoutSelect element and a logo element
layoutSelect.addEventListener('change', function() {
    if (layoutSelect.value === 'layout3_TOP' || layoutSelect.value === 'layout3_bottom') {
        logo.style.color = '#ffffff';
    } else {
        logo.style.color = ''; // Reset or set to the default color
    }
});