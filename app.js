// Assuming the existing code structure and the relevant part of app.js
document.querySelector('select.layoutSelect').addEventListener('change', function(event) {
    let selectedLayout = event.target.value;
    let logoColor;

    // Check for specific layouts
    if (selectedLayout === 'layout3_TOP' || selectedLayout === 'layout3_bottom') {
        logoColor = '#ffffff'; // Set logo color to white
    } else {
        logoColor = determineDefaultLogoColor(selectedLayout); // Custom function to define default color based on layout
    }

    // Assume there's a function to update the logo's color
    updateLogoColor(logoColor);
});

function updateLogoColor(color) {
    const logo = document.querySelector('.logo');
    logo.style.color = color;
}